# Windows setup and acceptance

This is an incomplete development build. No installer or professional video has passed acceptance. See DEVELOPMENT_STATUS.md for executed evidence. The current Graphite Studio frontend is preserved.

## Runtime compatibility

| Runtime | Requirement / observed state |
| --- | --- |
| Windows | Intended target: Windows 11 x64. Native application/installer acceptance pending. |
| Node | 22.13 or newer for unflagged `node:sqlite`; actual tests use 24.20.0. Electron must also expose `node:sqlite`. |
| Python | Current WhisperX source declares `>=3.10,<3.14`. Installed Python 3.15.1 is unsuitable for this inference stack. Use a separate compatible environment; Windows wheels must resolve before installation. |
| Speech | Real `faster-whisper`, `whisperx`, PyTorch and CTranslate2 plus multilingual ASR and compatible local alignment model directories. No models are bundled or silently downloaded. |
| FFmpeg | Separate Windows executables for FFmpeg and FFprobe. Doctor checks required filters and H.264/AAC encoders. Audio enhancement, probing and quality verification require them even when Remotion renders visuals. |
| Remotion | Install `remotion`, `@remotion/bundler`, `@remotion/renderer` at the application root with the same exact resolved 4.x version. Configure a supported installed Chromium executable. No browser download is assumed. |
| Electron | Runtime and electron-builder are not installed here. Embedded Node/SQLite preflight runs before packaging. |

Official sources checked: [WhisperX Python/dependency metadata](https://github.com/m-bain/whisperX/blob/main/pyproject.toml), [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [CTranslate2 installation](https://opennmt.net/CTranslate2/installation.html), [Remotion requirements](https://www.remotion.dev/docs/), [Node SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), [electron-builder v26 configuration](https://www.electron.build/v26/docs/configuration/).

## Dependency setup

Registry/network access in this session fails with EACCES. The following are setup instructions for an environment with permitted access; they have **not** succeeded here. Do not treat the declared Remotion range as an installed or certified release. Resolve matching versions, commit lockfiles and repeat acceptance after resolution.

From the project folder in PowerShell, use `npm.cmd` because this machine blocks `npm.ps1`:

```powershell
npm.cmd install
$remotionRelease = (npm.cmd view remotion@4 version --json | ConvertFrom-Json)[-1]
npm.cmd install --save-exact "remotion@$remotionRelease" "@remotion/bundler@$remotionRelease" "@remotion/renderer@$remotionRelease"
npm.cmd install --save-dev --save-exact electron electron-builder@26
```

Inspect the resolved manifests/Node requirements and Remotion's applicable license before distributing. The root manifest includes the render dependencies so the packager can include production dependencies. The composition manifest documents the same runtime boundary; avoid installing a second, mismatched package set there.

Choose an **existing compatible Python executable**. The path below is a placeholder that must be replaced:

```powershell
$speechPython = 'C:\Path\To\CompatiblePython\python.exe'
& $speechPython -m venv .venv
& .\.venv\Scripts\python.exe -m pip download --only-binary=:all: --dest artifacts/python-wheels -r backend/requirements.txt
& .\.venv\Scripts\python.exe -m pip install --no-index --find-links artifacts/python-wheels -r backend/requirements.txt
& .\.venv\Scripts\python.exe -m pip freeze | Set-Content backend/requirements-lock.txt
& .\.venv\Scripts\python.exe backend/speech_worker.py diagnose
```

The wheel-only download is a compatibility check, not proof that inference works. If dependency resolution fails, investigate the actual package/platform requirements before installing. No GPU installation is assumed; the worker currently uses CPU/int8 ASR and CPU alignment.

Obtain licensed multilingual faster-whisper and alignment models using their official distribution instructions. Configure absolute local directories. The alignment model must cover the recognized language; Hindi-English code switching may produce unsupported characters or untimed words. Those cases fail alignment and save `analysis/transcript-needs-review.json`, rather than inventing timestamps. Correct the transcript and import real reviewed word timings when necessary; imported timing is labeled review-required and does not pass automated full ASR acceptance.

## Launch and configuration

```powershell
npm.cmd test
npm.cmd run test:python
npm.cmd run build
npm.cmd start
```

Open the full local URL printed by the server, including the session fragment. In Runtime settings, configure FFmpeg/FFprobe, compatible Python, local ASR/alignment model directories and Chromium. Select Remotion explicitly. The legacy FFmpeg renderer remains an explicit existing option; failed Remotion rendering never falls back to it.

For Gemini/Pexels, set `GEMINI_API_KEY` and `PEXELS_API_KEY` in the backend process environment using your local secret-management method **before starting**. Keys are not saved in project JSON or returned to the renderer. Choose an actual model from **List available models**, then select Gemini planning and Pexels stock retrieval. No model ID is guessed. Restart the backend after changing its process environment. Prompts send transcript/timeline/style metadata to Gemini; raw video rendering stays local. Pexels relevance and licenses still require review.

Projects, imported media, analysis, renders and quality evidence are stored locally. SQLite retains project indexing/job history alongside existing project JSON snapshots. Only one backend may own a data root. Interrupted jobs are marked failed and require explicit retry. Cancel, preview and export refer to actual jobs/files; progress is indeterminate when a runtime cannot measure it.

`npm.cmd run doctor` reads diagnostics without recovering or modifying a running application's jobs. Actual output reports missing tools, Python compatibility, packages and provider configuration. A module-presence flag is not live inference/render verification.

## Real-media acceptance

Prepare a real Hinglish recording, optional reference, and licensed music. Paths here are placeholders:

```powershell
npm.cmd run acceptance -- --raw 'C:\Media\hinglish-talking-head.mp4' --music 'C:\Media\licensed-music.wav' --reference 'C:\Media\reference.mp4'
```

This creates an isolated project under `artifacts/real-acceptance-*`, imports real media, runs speech/alignment/Gemini, retrieves stock when selected, renders composition preview and final output, and decodes/inspects the result. Configure `data/settings.json` through the UI first, or pass `--settings <absolute-settings-file>`.

Acceptance does not invent human approvals. Inspect actual exported frames and listen to audio in the app; approve only features with matching passing output evidence. To open an isolated acceptance project, start a separate backend with `REELFORGE_DATA` set to that isolated root after its runner exits. `server/index.mjs` honors that data-root environment variable. Native Electron uses the same variable when set.

Inspect an existing project without taking the application's lease or mutating it:

```powershell
npm.cmd run acceptance -- --project '<project-id>' --root '<project-data-directory>'
```

Results are written to `artifacts/acceptance-result.json`. Missing runtimes/media cause `blocked` with exit 1. Missing evidence or reviews remain `incomplete`. Synthetic footage and hand-authored synthetic words cannot certify recognition, Hinglish timing, reference fidelity or professional quality.

Full reference-style matching is still unavailable. A mandatory reference currently blocks professional completion. Measured hard-cut candidates, signal colour and aggregate audio are reported separately from unavailable OCR/graphic/zoom/semantic B-roll analysis.

## Windows desktop and installer

```powershell
npm.cmd run desktop
npm.cmd run package:windows
```

These require installed Electron/electron-builder and resolved production dependencies. The packager requires a lockfile and built frontend, checks matching Remotion versions and Electron's embedded SQLite, then requests a per-user x64 NSIS installer. The allowlist excludes user projects, media, tools and `.env` files. App files are unpacked to support Python/Remotion paths. FFmpeg, Python, models and Chromium remain explicit external prerequisites; this is not a self-contained offline installer.

Packaged project storage uses Electron `userData/projects`, not the installation folder. Existing development data stays in `data`. Native file selection and export use restricted IPC; the renderer has context isolation, sandboxing and no Node integration. Shutdown cancels and awaits managed jobs before closing SQLite. Native startup/shutdown, install/uninstall, exports, code signing, model redistribution and clean-machine acceptance are pending. Packaging a file does not certify those operations.

The actual current packaging result is `artifacts/windows-package-result.json`: blocked, no installer generated.
