# Inheritance

Layer: zcode-tui, an OpenTUI React application.

The designated parent for terminal interactions is opencode's TUI.
Its provider categories, Favorites/Recent sections, flat dialogs, subdued
secondary text, selected-row treatment, mouse paths and keyboard behavior
own these decisions. OpenTUI supplies terminal layout and rendering.

This terminal application does not adopt the Dioxus/libyggterm desktop
component implementation. The ydesign navigation and documentation layout
apply; the opencode parity requirement governs the visual language.
Colors continue to come from the existing `src/tui/design.ts` theme tokens.
See [plan-dialog decisions](01-plan-dialogs.md) for the exact inspected reference.
