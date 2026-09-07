---
name: zcode-tui
description: Drive, debug, and extend the zcode-tui — a polished OpenTUI
  frontend speaking the ZCode Protocol v4 to the packaged app-server (same
  stores/identity as the desktop). Use when a task touches ~/gh/zcode-tui,
  the v4 protocol, or running the TUI in a terminal/row.
---

# zcode-tui agent skill

## Run

```sh
cd ~/gh/zcode-tui
bun run tui            # the TUI (keys in README)
bun run probe:battery  # protocol acceptance (GREEN required before ship)
bun test               # client suite (4 pass)
tools/verify.sh        # staged PTY drive of every verb (timing-sensitive)
bun build --compile src/tui/main.tsx --outfile dist/zcode-tui
```

## Hard-won laws (violating these re-derives days)

1. **Envelope is `{method, params, id}`** — top-level `id`; replies
   `{id, result}|{id, error}`; server→client asks use `"server-<n>"` ids.
   `requestId` exists only INSIDE some params schemas.
2. **A session must be `session/subscribe`d or the UI sees no events** —
   send "works" silently otherwise (this bug shipped once).
3. **Sessions are per-instance** — foreign sessions list fine but
   read/resume/subscribe need `session/resume` in YOUR instance (-32004).
4. **Server asks must be answered** with schema-valid minimums:
   `session/requestRuntimePreferences` → `{nativeSearchEnhancementsEnabled:false}`;
   `interaction/requestPermission` → `{decision:"allow"}` (the option
   OBJECT records a deny).
5. **workspace-scoped methods** take `{workspace:{workspacePath,workspaceKey}}`.
6. **Spawn shape**: `ELECTRON_RUN_AS_NODE=1 /opt/ZCode/zcode
   /opt/ZCode/resources/glm/zcode.cjs app-server`. `/proc/cmdline` lies
   (setproctitle) — never trust it for the desktop's own children.
7. **OpenTUI core is ESM-with-TLA**: dynamic import; `@opentui/react/test-utils`
   gives headless `testRender`/`captureCharFrame`; `<input>` refs have
   focus/blur/value and `onKeyDown` is OBSERVATIONAL (cannot consume keys —
   arrows still move the caret; design dialogs accordingly); mock-keys
   pressKey/typeText target the renderer bridge, NOT the React keyHandler
   (useKeyboard won't see them — drive dialogs through a real PTY).
8. **useKeyboard closures are fresh** (useEffectEvent) but a typed burst
   may arrive as ONE KeyEvent per char — never assume batching.
8. **zod is `.strict()` everywhere** — send `{}` first, read the error's
   named fields, iterate. That is the fastest schema discovery loop.

## Instrument notes

- Raw `script` PTY captures are frame-diff garbage (cursor moves) — verify
  layout with headless `captureCharFrame`, verify behavior with markers in
  staged runs, verify state with stderr prints (script routes the child's
  stderr INTO the capture).
- The backend's cold start reconnects all MCP servers — budget 8-25s for
  the first list; repeated spawns throttle (staged single-spawn passes).

## Ship checklist

typecheck → bun test → probe:battery → build binary → PTY smoke the binary
→ commit+push (github + forgejo mirror) → gh release with binary attached.
