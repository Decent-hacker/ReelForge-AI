"""Local inference worker. Real model calls are lazy; diagnostic/tests need no AI packages."""
from __future__ import annotations
import argparse
import contextlib
import importlib.util
import importlib.metadata
import json
import math
import os
from pathlib import Path
import sys
import unicodedata


def emit(kind, **values):
    sys.__stdout__.write(json.dumps({"type": kind, **values}, ensure_ascii=False) + "\n")
    sys.__stdout__.flush()


def diagnostics():
    modules = {}
    for name, distribution in [("faster_whisper", "faster-whisper"), ("whisperx", "whisperx"), ("torch", "torch"), ("ctranslate2", "ctranslate2")]:
        present = importlib.util.find_spec(name) is not None
        try:
            version = importlib.metadata.version(distribution) if present else None
        except importlib.metadata.PackageNotFoundError:
            version = None
        modules[name] = {"available": present, "version": version}
    compatible = (3, 10) <= sys.version_info[:2] < (3, 14)
    return {"python": sys.version.split()[0], "executable": sys.executable, "modules": modules,
            "pythonCompatible": compatible, "supportedPython": ">=3.10,<3.14 (current WhisperX project requirement)",
            "available": compatible and all(value["available"] for value in modules.values())}


def local_directory(value, label):
    if not isinstance(value, str) or not value or not Path(value).is_absolute() or not Path(value).is_dir():
        raise ValueError(f"{label} must be an existing absolute local model directory.")
    return Path(value).resolve()


def validate_words(words, duration):
    result, missing, previous = [], [], 0.0
    for word in words:
        text = str(word.get("word", word.get("text", ""))).strip()
        if not text:
            continue
        start, end = word.get("start"), word.get("end")
        if not all(isinstance(n, (float, int)) and not isinstance(n, bool) and math.isfinite(n) for n in [start, end]):
            missing.append(text)
            continue
        if start < previous or end <= start or end > duration + .05:
            missing.append(text)
            continue
        result.append({"text": text, "start": round(start, 3), "end": round(end, 3), "keyword": False})
        previous = end
    return result, missing


def infer(request):
    audio = Path(request["audio"])
    if not audio.is_absolute() or not audio.is_file():
        raise ValueError("Speech input must be an existing absolute media path.")
    duration = request["duration"]
    if not isinstance(duration, (float, int)) or not math.isfinite(duration) or not 0 < duration <= 600:
        raise ValueError("Speech input duration must be between 0 and 600 seconds.")
    language = request.get("language", "auto")
    if language not in ["auto", "hi", "en"]:
        raise ValueError("Supported speech languages are auto, hi and en.")
    model_dir = local_directory(request.get("asrModel"), "faster-whisper model")
    align_dir = local_directory(request.get("alignModel"), "WhisperX alignment model")
    if model_dir.name.endswith(".en"):
        raise ValueError("Use a multilingual speech model for Hindi-English content.")
    health = diagnostics()
    if not health["available"]:
        if not health["pythonCompatible"]:
            raise RuntimeError("Unsupported speech Python runtime: " + health["python"] + "; " + health["supportedPython"])
        absent = [name for name, item in health["modules"].items() if not item["available"]]
        raise RuntimeError("Speech dependencies are unavailable: " + ", ".join(absent))
    # Models are explicitly local. No hidden model/remote-code download is permitted.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    emit("stage", stage="loading-speech-model", progress=None)
    with contextlib.redirect_stdout(sys.stderr):
        from faster_whisper import WhisperModel
        from faster_whisper.audio import decode_audio
        waveform = decode_audio(str(audio), sampling_rate=16000)
        model = WhisperModel(str(model_dir), device="cpu", compute_type="int8", local_files_only=True,
                             cpu_threads=min(8, os.cpu_count() or 1))
        segments, info = model.transcribe(waveform, language=None if language == "auto" else language,
                                          task="transcribe", word_timestamps=True, vad_filter=True,
                                          vad_parameters={"min_silence_duration_ms": 350}, beam_size=5)
        source_segments, estimated = [], []
        for segment in segments:
            source_segments.append({"start": segment.start, "end": segment.end, "text": segment.text})
            estimated.extend({"word": w.word, "start": w.start, "end": w.end} for w in segment.words or [])
            emit("stage", stage="transcribing", progress=min(99, round(segment.end / duration * 100)))
    if not source_segments:
        raise RuntimeError("No speech was transcribed. Captions have not been fabricated.")
    emit("stage", stage="aligning-words", progress=None)
    with contextlib.redirect_stdout(sys.stderr):
        import whisperx
        alignment_model, metadata = whisperx.load_align_model(language_code=info.language, device="cpu", model_name=str(align_dir))
        aligned = whisperx.align(source_segments, alignment_model, metadata, waveform, "cpu", return_char_alignments=False)
    aligned_words = aligned.get("word_segments")
    if aligned_words is None:
        aligned_words = [word for segment in aligned.get("segments", []) for word in segment.get("words", [])]
    words, missing = validate_words(aligned_words, duration)
    canonical = lambda value: "".join(unicodedata.normalize("NFC", value).split())
    source_preserved = canonical("".join(s["text"] for s in source_segments)) == canonical("".join(w["text"] for w in words))
    result = {"words": words, "segments": source_segments, "language": info.language,
              "provenance": "faster-whisper+whisperx-local", "timingReviewRequired": True,
              "alignment": {"method": "whisperx", "status": "complete" if words and not missing and source_preserved else "incomplete",
                            "sourceTextPreserved": source_preserved,
                            "unalignedWords": missing, "estimatedWords": estimated,
                            "note": "Forced-alignment timing still requires review, especially across Hindi-English switching."}}
    if missing or not words or not source_preserved:
        emit("partial-result", result=result)
        raise RuntimeError(f"Alignment incomplete: {len(missing)} invalid timed words; source text preserved: {source_preserved}. Review/correct the transcript; no interpolation was silently substituted.")
    emit("result", result=result)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["diagnose", "transcribe"])
    parser.add_argument("--request")
    args = parser.parse_args()
    try:
        if args.command == "diagnose":
            emit("result", result=diagnostics())
        else:
            if not args.request:
                raise ValueError("--request is required.")
            infer(json.loads(Path(args.request).read_text(encoding="utf-8")))
    except Exception as error:
        emit("error", error=str(error))
        print(str(error), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
