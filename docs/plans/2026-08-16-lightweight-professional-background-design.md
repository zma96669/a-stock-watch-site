# Lightweight professional chart background

## Goal

Make the editor background chart readable at a glance without competing with source code.

## Visual design

- Draw the previous close as a subtle dashed zero line.
- Split price segments at the zero line: red above previous close and green below it.
- Keep the average-price line yellow and quieter than the price line.
- Add a very faint red or green fill between the price line and zero line.
- Mark the latest point and show a compact percentage label near the right edge.
- Reserve space before the editor minimap and clamp labels inside the visible canvas.

## Data and refresh

Reuse `previousClose`, intraday points, and the existing five-second bridge polling. No new market endpoint or background process is introduced.

## Fallbacks

If previous close is missing or invalid, use the first valid intraday price. If the canvas is too small, omit the percentage label while retaining the zero, price, and average lines.

## Verification

Move chart geometry and color segmentation into testable pure helpers. Verify symmetric scaling around previous close, red/green segment splitting, percentage formatting, type checking, packaging, and runtime loading.
