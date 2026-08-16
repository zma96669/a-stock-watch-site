# Stealth background and persistent toggle

## Goal

Make the intraday chart look like a faint editor aid rather than an obvious market display, while providing a fast, persistent keyboard switch that hides only the editor background chart.

## Visual treatment

Use a monochrome graphite palette for the editor background. Remove red and green from the chart, average line, latest-price marker, and price labels; the status bar remains unchanged and continues to show the normal market state.

Remove the existing high minimum alpha values that make the chart conspicuous even when the configured opacity is low. Target approximately 8–10% alpha for the price trace, 5% for the zero axis, 2–3% for ordinary price/time guides, and lower-contrast scale and time labels. Keep the structure readable at close range without making the chart recognizable at a glance.

## Toggle behavior

Contribute `aStockWatch.toggleBackgroundVisibility` and bind it to `Ctrl+Shift+N`. This intentionally replaces VS Code's default New Window shortcut.

The command toggles only the editor background canvas, price labels, and time labels. It does not hide the watchlist view, activity-bar entry, chart panel, or stock status bar. It must not show a popup or other conspicuous confirmation.

Persist the hidden flag in extension global state. A newly installed extension defaults to visible; after the user hides the background, future VS Code sessions remain hidden until the shortcut is pressed again.

## Data flow

Add the persisted visibility flag to the local background bridge state. The injected loader applies it independently of quote availability: hidden state removes all background canvas and label elements from display, while visible state resumes drawing from the latest snapshot.

The toggle must be responsive rather than waiting for the normal five-second market-state poll. The local bridge will expose a lightweight change signal so the loader can refresh immediately when the command changes visibility. Normal quote refresh frequency remains unchanged.

If the bridge is temporarily unavailable, the command still updates persistent state. The loader adopts the saved state as soon as connectivity returns.

## Verification

Test command/keybinding contribution, default and persisted state, bridge visibility state, and loader behavior when hidden. Run TypeScript checks, the full automated suite, build and package the extension, visually inspect the stealth preview, then deploy a new content-hashed background loader so Electron cannot reuse the previous script.
