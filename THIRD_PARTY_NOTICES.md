# Graphite Studio dependency status

The Graphite Studio shell uses the existing React, Vite, TypeScript and Tailwind dependencies. No new dependency download succeeded during the redesign.

## Icons — requirement still pending

The current `src/components/ui.tsx` contains an in-repo SVG compatibility subset with consistent 16px sizing and 1.65 stroke weight. Several familiar geometries follow Feather-style conventions. **This is not an installed or verified vendored copy of `lucide-react`.** The requested Lucide dependency is pending because package-registry downloads fail with EACCES and no local Lucide installation was found. It must be replaced with official Lucide components when dependencies become accessible. The relevant official documentation was checked:

- https://lucide.dev/guide/react/
- https://github.com/lucide-icons/lucide/blob/main/LICENSE

No Lucide package version is invented or claimed to be installed.

For Feather-derived geometries, the upstream notice is retained below:

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Fonts — requirement still pending

The CSS uses Inter for interface text, JetBrains Mono for timecodes/technical values, and Manrope for selected dialog headings. Segoe UI and Consolas are explicit Windows fallbacks. The requested font binaries are not installed or bundled in this environment, so their actual use has **not** been verified. Self-hosted font files and their licenses must be added before exact typography acceptance. No remote font requests are made by the application.

This document records limitations; it does not treat substitutions as fulfilled requirements.
