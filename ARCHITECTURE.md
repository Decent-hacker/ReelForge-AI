# ReelForge AI functional architecture

## Preservation boundary

Keep Graphite Studio components/layout and current local API. Existing JSON projects/assets remain readable and are not replaced by a new template or destructively migrated. Add backend services incrementally and retain the original FFmpeg renderer as an explicitly selected legacy option, never an automatic fallback for a failed Remotion edit.

## Services

1. **Local API / desktop host:** current Node server and Electron shell. Browser-facing routes stay token-authenticated and same-origin. API/provider keys live in process environment only; diagnostics return presence/capability flags, never key values.
2. **Persistent catalog/jobs:** SQLite project/job metadata plus existing asset folders/JSON snapshots. Job state, stage, measurable progress, inputs, errors and terminal outcomes survive restart. Interrupted jobs require explicit retry; they are not falsely marked successful. A single owning service process must control each data root.
3. **Speech worker:** isolated Python process with a line-delimited JSON protocol. faster-whisper produces original-language segments; compatible WhisperX alignment refines timed words. Local model directories are explicit. Missing language/alignment coverage is recorded, not interpolated and called aligned. Existing whisper.cpp/import paths remain explicitly selectable alternatives.
4. **Provider adapters:** server-side Gemini structured planning and Pexels search/download. Bounded retries, schema validation, allowed effect types, duration/asset bounds, attribution/license provenance and missing-provider outcomes are part of the contract. Optional visual-generation adapters expose availability and typed jobs; no paid provider is required by default and no fake generator is supplied.
5. **Composition compiler:** validated project timeline to frame-accurate renderer input. Cut-time mapping, words, scenes, B-roll and audio refer to one timeline contract. Remotion compositions own actual visuals; FFmpeg performs audio preparation, probing and verification. Draft preview and final export use the same composition at different render scales.
6. **Quality gate:** actual media metadata/decode/black-frame/audio checks plus visual/audio ablations and review. Evidence includes output and timeline hashes. Required features cannot pass based only on JSON intent. Incomplete drafts remain clearly labeled.

## Runtime choices

The request recommends FastAPI. Replacing a tested Node API adds migration risk without resolving the missing media/speech runtimes. This implementation retains Node orchestration and isolates Python inference behind it; a FastAPI transport can be introduced later without changing the worker or timeline contract. SQLite does not require a third-party service. Remotion and its browser/media dependencies must be installed and executed before its adapter is considered available.

## Phases and acceptance

| Phase | Work | Acceptance |
| --- | --- | --- |
| 0 | Audit and baseline | Existing tests/build executed; limitations recorded |
| 1 | Persistent jobs/catalog, capability diagnostics, stage reporting and explicit API operations | Restart/error/cancellation/API tests using real local persistence |
| 2 | faster-whisper / alignment worker | Stdlib/protocol tests plus real recorded speech inference; missing dependencies block live acceptance |
| 3 | Gemini and Pexels integration | Strict contract tests clearly labeled fixtures; live calls require keys and allowed network |
| 4 | Remotion compiler/components/preview/export | Actual MP4s and rendered frames; no silent FFmpeg fallback |
| 5 | Audio, measured reference style and output verification | Actual audio/video measurements, ablations and listening/frame inspection |
| 6 | Real Hinglish end-to-end and Windows packaging | Full upload-to-export with requested features, native startup/shutdown and installer acceptance |

Each phase records modified files, executed checks, failures and remaining work in DEVELOPMENT_STATUS.md. Written-but-unexecuted integration code never counts as a passing phase.
