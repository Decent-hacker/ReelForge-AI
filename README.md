# ReelForge AI

Local Windows video editor with the existing Graphite Studio React interface. **Incomplete development build. No professional video, native desktop session or installer has passed end-to-end acceptance.**

The repository audit is in [IMPLEMENTATION_AUDIT.md](IMPLEMENTATION_AUDIT.md); implementation decisions are in [ARCHITECTURE.md](ARCHITECTURE.md). [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) separates executed tests from written integration code. [WINDOWS_SETUP.md](WINDOWS_SETUP.md) covers compatibility, dependency setup, provider configuration and real-media acceptance.

## Executed validation

- `npm.cmd test`: **48 passed**, zero failed/skipped. Includes real SQLite persistence, live local HTTP, process execution/cancellation, timeline invariants and quality-gate rejection cases. Provider tests use explicitly labeled contract fixtures, not live API results.
- `npm.cmd run test:python`: **4 passed**. Tests word validation/diagnostics, not speech inference.
- `npm.cmd run build`: TypeScript 6.0.3 and Vite pass, 41 modules.
- Running app HTTP smoke: UI, JS, CSS, bootstrap and existing timelines return 200. This is not browser interaction or media playback acceptance.
- `npm.cmd run doctor`: exit 1; required runtimes unavailable.
- `npm.cmd run acceptance`: **blocked**, no actual video checks executed and no output MP4.
- `npm.cmd run package:windows`: **blocked**, no installer produced.

## Start the available application

```powershell
npm.cmd run build
npm.cmd start
```

Open the full local URL printed by the server, including its session fragment. It binds to `127.0.0.1` with token-authenticated APIs. Set `REELFORGE_DATA` before startup to select a separate project-data directory; default development data remains in `data`. The native Electron launch is `npm.cmd run desktop` after its runtime has been installed and validated.

The existing frontend dependencies are locally available. Newly declared Remotion packages, Electron and speech dependencies are **not installed**. Registry access fails with EACCES in this environment. A dependency declaration is not evidence of a successful installation; there is no resolved lockfile yet.

## Connected implementation

- Existing project/media imports, copied/hashed local storage, timeline edits, undo/redo, save, review and export paths are retained.
- SQLite project index, persistent queued jobs, stages, nullable measured progress, event history, errors, cancellation and interruption recovery sit alongside existing JSON project snapshots. A data-root owner lock prevents competing backends from recovering each other's jobs.
- An isolated Python worker calls faster-whisper and WhisperX using explicit local models. It preserves spoken text and rejects incomplete alignment. Python 3.15.1 is outside current WhisperX requirements; a compatible environment is needed before inference.
- Server-side Gemini REST planning validates structured data against supported operations and bounded source/output times. Pexels search/ranking/download stores attribution and license provenance and probes downloaded video. Keys are read from process environment, never project settings. Both providers remain live-unverified without credentials.
- A shared frame timeline compiles cuts, captions, B-roll, zooms, transitions, titles/callouts/statistics and mixed audio to actual Remotion components. Preview and final jobs use that composition. The existing FFmpeg renderer remains an explicit legacy choice; a failed Remotion request never automatically substitutes it.
- Audio code prepares noise reduction, voice normalization/compression, ducked licensed music, synthesized accent cues and fades. Output code checks dimensions/fps/codecs/duration, full decoding, black intervals, audio peaks and sampled visual/audio ablations. None has executed against a real MP4 here.
- Runtime settings, Gemini Director proposals/apply/undo, Pexels asset search/download/assignment and actual rendered preview routes are connected to the preserved UI. Unsupported properties/providers remain explicitly unavailable.

This describes implemented code, **not confirmed inference or rendering capability**. No raw/reference recording is stored in either existing project. No synthetic transcript is used by a production route.

## Workflow once runtimes are available

1. Configure executable/model paths in Runtime & tools. Select the desired speech, planning, stock and rendering engines explicitly.
2. Create a project and import raw video, optional reference and licensed music. Import/tag approved B-roll or configure Pexels retrieval.
3. Analyze the recording; the backend probes media, measures silence, transcribes/aligns speech and builds a validated plan. Gemini decisions apply when that planning engine is selected.
4. Review/edit captions, scenes, zooms, B-roll and supported graphic overlays. The Director proposes reviewable changes; save before rendering.
5. Render preview or final composition. Inspect actual exported frames/audio and the quality panel. Correct errors rather than approving missing features.
6. Export a playable draft or reviewed result. Required failures retain **Incomplete — Review Required** and an `INCOMPLETE__` filename. A quality sidecar/report accompanies export.

Imported transcript JSON uses source-video seconds and actual reviewed word timings:

```json
{"language":"Hinglish","words":[{"text":"AI","start":0.4,"end":0.62,"keyword":true},{"text":"aaj","start":0.65,"end":0.9}]}
```

This is a schema example, not a transcription. Imported timings are labeled review-required and cannot stand in for full ASR/alignment acceptance.

## Quality contract

Every feature has planned/generated/rendered/verified/failed/skipped states, reasons and history. A timeline instruction cannot verify itself. Evidence is tied to output and plan hashes; changing the edit invalidates prior evidence. Perceptual checks need explicit human review after technical evidence passes. Energy at word times does not prove recognition accuracy; stream duration does not prove lip sync; sampled ablations do not prove every frame is correct.

Missing stock/music can produce an explicitly incomplete draft. Unsupported render instructions fail. Full reference-style extraction/matching is unfinished: measured hard-cut candidates, signal colour and aggregate audio are distinguished from unavailable OCR/caption/graphic/zoom/semantic analysis. A mandatory reference currently blocks professional completion. Optional visual-generation adapters have an interface but no working configured provider; no fake generator is supplied.

## Acceptance and limitations

```powershell
npm.cmd run acceptance -- --raw 'C:\Media\real-hinglish.mp4' --music 'C:\Media\licensed-music.wav'
npm.cmd run acceptance -- --project '<project-id>' --root '<project-data-directory>'
```

Replace example paths/IDs with real inputs. The first command runs the real pipeline in an isolated project; the second inspects an existing export read-only. It requires real speech/alignment, Gemini provenance, Remotion output, requested effects, technical decode and human reviews. It does not generate approvals or certify professional quality from synthetic media.

Evidence files include `artifacts/acceptance-result.json`, `artifacts/windows-package-result.json`, `artifacts/application-smoke.json` and per-project analysis/renders/reports. Source media is copied rather than overwritten.

Pending: live inference/API/render execution; real MP4 generation and rendered-frame/audio inspection; full reference-style extraction; concrete optional generation providers; native UI/keyboard/mouse acceptance; installer/signing/clean-machine validation; performance, crash/disk-full, retention and production security/accessibility review. Prior browser QA failed GPU startup and produced no screenshots. Exact icons/fonts remain documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); this functional task does not redesign the interface.

## Layout

`src/` UI and editor model; `server/` authenticated local API; `engine/` persistence/orchestration/analysis/composition/audio/quality; `backend/` local Python speech worker; `providers/` Gemini/Pexels/optional generation boundaries; `composition/` Remotion components; `electron/` isolated native host and builder config; `tests/` automated contracts/integration checks; `scripts/` diagnostics/build/acceptance/packaging.
