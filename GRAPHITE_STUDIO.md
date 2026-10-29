# Graphite Studio UI implementation

The editor now uses the exact requested colour tokens in `src/style.css`. The shell has a 48px application bar, 260px media panel, central program monitor, approximately 300px contextual inspector, resizable dividers and a timeline initially set to 35% of viewport height. No gradients, generated charts, decorative floating assets or imitation waveforms are used.

## Implemented controls

- Top bar: project name, actual dirty/save state, save, plan undo/redo, Editing/Captions/Review workspace selection and export dialog.
- Media: real project selection, native HTML file import, actual media counts, search, B-roll tags, caption word list, effects navigation and audio bin. Missing visual-generation integration has an explicit empty state.
- Monitor: actual source/reference/render selection, source/output time mapping, play/pause, frame steps, mute, fullscreen, safe-area guides and canvas-based half/quarter-resolution display. Downsampling changes the monitor image, not source decoding or export quality. Preview aspect ratio is calculated from real media metadata and available panel dimensions.
- Inspector: relevant scene scale, B-roll assignment and ranges, transcript words/timing/highlights, caption font/colour, title text, music level and sequence transition selection. Scene-linked animation/SFX parameters are shown as read-only facts. Position, opacity, arbitrary animation curves and per-clip transition effects are **not supported by the existing renderer**, so no fake editable controls were added for them.
- Timeline: seven real plan-derived tracks — Video, B-roll, Captions, Motion graphics, Sound effects, Voice, Music. Zoom, horizontal/vertical scrolling, playhead seeking, track/clip selection and context menus are implemented. B-roll and caption clips move/trim with frame quantization and optional speech-boundary snapping. Video scene shared edges adjust scene boundaries; they do not trim source recordings. Graphics/SFX follow scene timing; voice/music remain linked to sequence timing.
- AI Director: compact collapsible local-action panel. B-roll assignment uses approved matching tags; music reduction proposes an actual mix-level change. Proposals require Apply, enter normal undo history, and need save/render before appearing in output. Caption repair and full reference-style matching return explicit unavailable-feature errors.
- Saving appearance/audio preferences and a plan now works in one atomic backend request, with source-duration validation retained. All original API routes, imports, analysis, rendering, cancellation, evidence review and export integrations are preserved.

## Keyboard interactions implemented

| Shortcut | Action |
| --- | --- |
| Ctrl+N | New project dialog |
| Ctrl+I | Import into current supported media bin |
| Ctrl+S | Save current plan/preferences |
| Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | Undo / redo edits outside text-entry fields |
| Space | Play/pause outside native input/button controls |
| Left / Right | Previous / next preview frame |
| Left / Right on a caption or B-roll clip | Nudge one frame; Shift nudges ten frames |
| Home | Seek to sequence start |
| F | Fullscreen preview |
| S within timeline | Toggle snapping |
| Plus / minus within timeline | Zoom in/out |
| Alt while dragging | Bypass speech-boundary snapping |
| Escape while dragging | Cancel current drag |
| Escape in dialog/menu | Close dialog/context menu |

Panel splitters have keyboard arrow resizing. Native fields retain their normal keyboard behavior. Undo applies to editing-plan changes; source files are never modified. Up to 100 editing states are retained within the open project session.

## What was actually tested

- TypeScript 6.0.3 checking and Vite bundling passed after refactoring.
- 28 unit/integration tests passed, including new timeline movement/trim/bounds/contiguity/snapping/source-time tests, Director proposal/error tests and combined preference/plan persistence. Existing project, server, process and quality-gate tests still pass.
- These tests validate editing behavior and persistence, **not mouse dispatch in a running browser**.

## Visual acceptance remains blocked

- The in-app browser reported `Browser is not available: iab`.
- Native Computer Use inspection timed out waiting for app approval. No browser interactions or screenshots were completed through that route.
- An isolated installed Brave headless process failed with `GPU process isn't usable. Goodbye.` and no screenshot. No sandbox/security bypass was used.
- `npm.cmd run qa:ui` attempts actual screenshots at 1366×768, 1920×1080 and 1280×800 with a fresh test profile/project. Its actual result is recorded in `artifacts/graphite-qa/result.json`. Failed startup produces `blocked`, never a fabricated screenshot or a visual pass.
- Desktop-resolution layout, real keyboard/mouse dispatch, fullscreen/media playback/downsampling and screenshot-based spacing/alignment review remain **unverified** until a supported browser/native test environment is available.

## Dependencies and typography

The requested Lucide dependency and Inter / JetBrains Mono / Manrope font binaries are still unavailable. Package downloads fail with EACCES and no complete local copies were found. The current SVG compatibility subset and explicit Windows font fallbacks are recorded in `THIRD_PARTY_NOTICES.md`; they do not fulfill exact Lucide/font acceptance.

**The UI redesign is implemented but not accepted as visually complete.** Remaining requirements are dependency integration, actual desktop interaction tests, screenshots, visual defect review/fixes and native Electron acceptance. Overall professional-video acceptance remains separately blocked as documented in DEVELOPMENT_STATUS.md.
