# Muted price and time grid

## Goal

Make approximate price and time ranges readable while keeping source code visually dominant.

## Price grid

Use five fixed horizontal levels: range maximum, upper midpoint, previous close, lower midpoint, and range minimum. Fixed scale labels use neutral gray. Only the current-price label keeps a muted red, green, or gray state color.

## Time grid

Divide the A-share trading day into four equal session segments with markers at `09:30`, `10:30`, `11:30/13:00`, `14:00`, and `15:00`. The lunch break shares the center marker because the chart already uses a compressed 240-minute trading axis.

## Current price

Keep the latest-point marker and add a short horizontal dashed guide near it. Avoid a full-width current-price line because it could be mistaken for future unchanged prices during live trading.

## Visual treatment

Grid lines and fixed labels use low-opacity neutral gray. Label backgrounds become less opaque. The current label uses a lower-saturation red or green than the price line.

## Verification

Test fixed price levels and trading-time markers, render the preview fixture, run the full suite, package version 0.1.9, and deploy it with the content-hashed loader path.
