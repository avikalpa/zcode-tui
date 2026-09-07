# Security

Report vulnerabilities privately to avi@gour.top rather than opening a
public issue. Please include: what you sent to the app-server, what came
back, and the ZCode desktop version (`ZCODE_APP_VERSION`).

Scope notes: zcode-tui spawns the locally installed ZCode runtime and
speaks its documented protocol with the same privileges as the user. It
stores nothing beyond what the shared `~/.zcode` store already holds.
Bugs in ZCode itself belong to Z.ai's own channels — but if a bug in
zcode-tui makes the shared store do something the desktop alone would
not, that is ours and we want it.
