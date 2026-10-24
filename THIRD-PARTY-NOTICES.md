# Third-party notices

zcode-tui depends on the following third-party packages (npm, direct and
transitive as of v0.5.0). Each is used unmodified under its own licence;
all are compatible with this project's GPL-3.0-or-later. Generated from the
resolved dependency tree — regenerate with the audit command in
CONTRIBUTING.md.

| package | version | licence |
|---|---|---|
| @opentui/core | 0.5.11 | MIT |
| @opentui/react | 0.5.11 | MIT |
| react | 19.2.8 | MIT |
| react-reconciler (transitive) | — | MIT |
| scheduler (transitive) | — | MIT |
| typescript (devDependency) | 5.x | Apache-2.0 |
| @types/react (devDependency) | — | MIT |
| @types/bun (devDependency) | — | MIT |
| diff (transitive) | — | BSD-3-Clause |

The Bun runtime (MIT, Oven) compiles and hosts the program; the release
binaries embed it. The ZCode desktop/runtime itself (`/opt/ZCode`) is
proprietary Z.ai software: zcode-tui never distributes or links it — it
spawns the locally installed runtime, unmodified, and speaks its documented
protocol.

## OpenCode interaction and status adaptations

Composer history navigation, picker interaction and MCP status presentation
adapt the MIT-licensed OpenCode TUI. Reference for the 2026-10-24 pass:
`b084acc55ea2cdb50e9c2ec49a8d9ab3608d43ad`, files
`packages/tui/src/{prompt/history.tsx,component/prompt/index.tsx,ui/dialog-select.tsx,component/dialog-status.tsx}`.

MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
