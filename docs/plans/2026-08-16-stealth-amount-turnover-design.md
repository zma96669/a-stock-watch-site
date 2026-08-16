# Stealth amount bars and turnover summary

## Goal

Add useful intraday activity context to the stealth editor background without making it look like an obvious market terminal.

## Amount bars

Draw a monochrome graphite histogram in the bottom 12–15% of the editor. Each bar represents that minute's traded amount, not share volume. Amount is already present in the East Money intraday response.

Scale bar heights against the day's 95th percentile minute amount so that one exceptional minute does not flatten the rest of the histogram. Ignore missing, non-finite, negative, and zero values. Bars remain very low opacity and never use red or green.

The existing `aStockWatch.background.showVolume` setting controls the histogram for backward compatibility, but its default changes to `true`. An explicit user value of `false` remains respected.

## Summary label

Show a subtle bottom-right label in the chart area using this shape:

`额 1260万 · 换 0.83%`

`额` is the latest minute's traded amount. Format values automatically in yuan, ten-thousands, or hundred-millions. `换` is the current day's overall turnover rate, refreshed with the normal five-second quote request. Add East Money quote field `f8` and expose it as an optional turnover-rate value in the market snapshot. If it is unavailable, display `换 --`.

## Visibility and layout

The amount histogram and summary label are part of the editor background. `Ctrl+Shift+N` hides and restores them together with the price chart, grids, and axes. The watchlist and status bar remain unaffected.

Keep the summary clear of the time axis and price gutter. Hide it in editors too small to support the layout. No hover interaction or popup is added.

## Verification

Test quote turnover parsing, amount formatting, percentile scaling, default configuration, and hidden-state behavior. Update the browser preview with representative minute amounts and turnover rate, run all checks and tests, package version `0.1.11`, visually inspect visible and hidden states, then deploy a new content-hashed loader.
