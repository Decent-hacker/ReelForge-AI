# ReelForge AI implementation audit

Audit date: 2026-10-27. Audit performed before application code changes for the full-functional-implementation request.

## Repository and framework

- Existing React 18.3.1 / TypeScript frontend, Vite 5.4.21 build, Tailwind 3.4.19, Graphite Studio CSS tokens/layout. No starter replacement is necessary.
- `src/App.tsx` owns project state, API calls, undo/redo, jobs, settings and export. Reusable components: `MediaPanel`, `Preview`, `Inspector`, `Timeline`, `Director` and UI primitives.
- `src/editor/model.mjs` provides real cut-time mapping, clip movement/trimming, snapping and two deterministic Director commands. Tests import the same functions used by the UI.
- Node HTTP API in `server/index.mjs`, orchestration in `engine/service.mjs`, JSON/local-file storage in `engine/store.mjs`, FFmpeg graph/render/evidence code in `engine/render.mjs`, ASS captions in `engine/captions.mjs` and local whisper.cpp adapter in `engine/transcript.mjs`.
- Electron main/preload source has context isolation, disabled renderer Node access, sandbox, origin checks, file/save dialogs and backend lifecycle code. Electron is not installed and native launch/package acceptance has not run.
- No AGENTS.md found in the current repository inventory. No Git repository/commit baseline is assumed.

## Existing routes

All `/api` routes require the random session token; host/origin restrictions and CSP are implemented.

| Route | Existing behavior | Evidence |
| --- | --- | --- |
| GET `/api/bootstrap` | Projects, runtime settings and diagnostics | Live HTTP tests |
| POST `/api/settings` | Local tool path validation and storage | Source inspected; runtime-dependent |
| POST `/api/projects` | Create local project | Storage and HTTP tests |
| GET/PATCH `/api/projects/:id` | Read project; update preferences/tags/plan/name | Tests include combined preference/plan save |
| POST `/api/projects/:id/import` | Stream approved media roles to project folders; hash copied input | HTTP/storage tests; extension alone does not prove valid media |
| POST `/api/projects/:id/analyze` | Probe, transcript, reference pacing and deterministic planning job | Failure paths tested; actual media run blocked |
| POST `/api/projects/:id/render` | FFmpeg render and output/effect checks | Instruction-generation tests only; real rendering blocked |
| POST `/api/projects/:id/cancel` | Abort active native process/job | Actual child-process cancellation tests |
| POST `/api/projects/:id/review` | Review evidence tied to output/plan hashes | Integrity/gate tests |
| GET `/api/projects/:id/report` | Current quality report | API source and integration tests |
| GET/HEAD `/api/projects/:id/media/:assetId` | Allowlisted media and byte ranges | Live range-request tests |
| GET `/api/projects/:id/media` | Rendered output | Requires actual completed render |
| GET `/api/projects/:id/preview` | Rendered thumbnail | Requires actual completed render |
| GET `/api/projects/:id/export` | Hash-checked MP4; incomplete filename until gate passes | Integrity rejection tests; actual MP4 blocked |

Dedicated transcription, AI plan, stock asset, composition preview and durable job-history endpoints are missing before this phase.

## Functional classification

| Capability | Audit finding |
| --- | --- |
| Project creation / upload / local folders | Implemented, tested. Inputs are hashed. Two existing projects have no assets. |
| Metadata | Real FFprobe implementation; unavailable executable means no actual-media proof. |
| Hindi/English/Hinglish | Text preservation/manual correction implemented. Existing CLI adapter is whisper.cpp, not faster-whisper. Word estimates are not forced alignment. |
| Silence removal | Based on word gaps; no waveform/VAD silence measurement integrated. |
| Reference analysis | Hard-cut detection/median shot duration only. No caption/OCR, zoom, B-roll or audio-style extraction. |
| AI decisions | Two local deterministic proposals. No Gemini/network AI integration. |
| Stock / generated visuals | Not implemented. Missing contextual B-roll is explicit; no fake assets. |
| Effects/audio/colour | Real FFmpeg instructions are written; no execution or frame/listening verification. SFX are synthesized chimes, not a professional sound library. |
| Timeline | Shared model implements bounds/trim/snap/selection; actual browser mouse/keyboard acceptance remains blocked. |
| Preview | Actual video element, transport and monitor downsampling; no Remotion composition preview. |
| Export/quality | Hash-based evidence gate and draft distinction implemented. Ablation/decoded-media check code has not executed against real rendered output. |
| Job persistence | Latest job embedded in project JSON; active tasks in memory. No SQLite job history or durable queue. Analysis uses coarse stage percentages; renderer progress is only intermittently persisted. |

## UI control audit

- Import, project selection, tags, save, analyze, generate, cancel, review and export call real APIs.
- Undo/redo, timeline moves/trims, scale, B-roll assignment, caption text/times/keyword marks, font/accent, music level and sequence preferences modify the actual plan/preferences.
- Playback, stepping, mute, fullscreen, guides and quality selection operate on the real monitor element; they have not passed browser interaction acceptance.
- Effects navigation selects existing inspector data. Graphics/SFX timing and animation values are deliberately read-only when unsupported by the renderer.
- Generated visuals has an explicit unavailable-provider state. Unsupported Director commands return errors. No fake chatbot processing or generated preview is present.
- Position, opacity and arbitrary transitions/animation curves are not falsely exposed as editable.
- Existing icon/font substitutions remain documented; this functional task will not redesign them.

## Mock data

No production route or default UI uses a fabricated project, transcript, chart, waveform or asset list. Unit tests use explicitly synthetic timing and malformed-media fixtures. The acceptance harness can generate synthetic MP4s with FFmpeg, but this path has never run and does not certify speech recognition. New provider contract tests must be labeled fixtures, never live-provider evidence.

## Dependencies / Windows findings (executed again)

- Node v24.20.0, npm.cmd 11.19.0; baseline `npm.cmd test`: **28 passed, 0 failed, 0 skipped**; baseline build: TypeScript 6.0.3 and Vite pass, 40 modules.
- Python 3.15.1, pip 26.2.2. `fastapi`, `uvicorn`, `faster_whisper`, `whisperx`, `torch` and `ctranslate2` are absent.
- FFmpeg / FFprobe: spawn ENOENT; whisper CLI/model unconfigured. `npm.cmd run doctor` exits nonzero.
- Remotion registry compatibility lookup attempted with a workspace-local cache and bounded timeout: **EACCES**. No install success is claimed.
- GEMINI_API_KEY and PEXELS_API_KEY are absent. Their values were not requested or printed.
- No raw/reference/test recording exists in the two current project folders. A local Hinglish recording path was requested asynchronously for acceptance.
- Native speech wheel compatibility on Python 3.15 is not established. A separate supported Python environment and explicit local models are required; no assumed package version or GPU stack is installed.
- Prior installed Chromium tests failed GPU startup and native UI access timed out. Remotion browser rendering remains a separate unmet runtime requirement.

## Audit conclusion

Preserve the frontend and functioning Node/local-file architecture. Add validated provider boundaries, persistent jobs/catalog, a Python speech worker and optional Remotion renderer behind the existing API. Do not call the existing effect graph or any newly written adapter verified until its actual runtime/API has executed. No basic render may silently substitute for a requested Remotion/AI edit.

Official API/compatibility sources consulted: [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [WhisperX](https://github.com/m-bain/whisperX), [CTranslate2 Windows requirements](https://opennmt.net/CTranslate2/installation.html), [Gemini REST](https://ai.google.dev/api/generate-content), [Gemini structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [Pexels API](https://www.pexels.com/api/documentation/), [Remotion requirements](https://www.remotion.dev/docs/), [Remotion renderer](https://www.remotion.dev/docs/renderer/render-media).
