# Price scale gutter

## Goal

Make the intraday background interpretable without requiring the user to infer prices from line height.

## Layout

Detect the Monaco minimap position at runtime and reserve a compact scale gutter immediately to its left. The chart ends before the gutter, so neither lines nor labels run underneath the minimap.

## Scale content

- Top: symmetric range maximum with positive percentage.
- Current: latest price and current percentage, colored red, green, or gray.
- Middle: previous close and `0.00%`, aligned with the dashed zero line.
- Bottom: symmetric range minimum with negative percentage.
- Two faint quarter-grid lines provide additional vertical reference without adding labels.

If the editor is too narrow, the gutter is hidden and the chart falls back to the existing compact rendering.

## Verification

Test scale label formatting and chart layout with and without a minimap. Run the full extension test suite, build the browser loader, render the preview fixture, package, and install version 0.1.6.
