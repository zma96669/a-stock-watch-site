# Session opacity shortcuts

## Goal

Let the user temporarily make the stealth market background easier or harder to see without changing the persistent VS Code configuration or weakening the existing emergency hide shortcut.

## Keybindings

- `Ctrl+Alt+>` increases effective background opacity by `0.02`.
- `Ctrl+Alt+<` decreases effective background opacity by `0.02`.
- `Ctrl+Shift+N` continues to toggle the complete editor background and also clears any temporary opacity adjustment.

Because `>` and `<` require Shift on the target keyboard, VS Code contributes these as `Ctrl+Alt+Shift+.` and `Ctrl+Alt+Shift+,`.

## Session state

Keep the temporary opacity override only in extension-host memory. Never write it to workspace, user configuration, or global state. Extension restart therefore restores the configured opacity automatically.

Clamp the effective opacity to `0.02–0.35`. The configured `aStockWatch.background.opacity` value remains the baseline; it defaults to `0.08`. Pressing `Ctrl+Shift+N` clears the override before toggling visibility, so the next visible state always uses the baseline.

## Data flow

Add two commands for increasing and decreasing opacity. They update an in-memory session controller and notify the existing local background bridge. The bridge snapshot exposes the effective opacity, allowing the injected loader to redraw immediately through its current event channel rather than waiting for the five-second quote poll.

The opacity continues to affect the price trace, average line, guide grid, amount bars, price/time labels, and amount/turnover summary together. No popup or notification is shown.

## Verification

Test step size, clamping, reset, and non-persistence semantics; verify manifest keybindings and that `Ctrl+Shift+N` resets before toggling. Run the complete suite, package version `0.1.12`, preview multiple opacity levels in a real browser, and deploy a new content-hashed loader.
