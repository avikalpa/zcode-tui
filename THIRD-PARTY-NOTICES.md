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
