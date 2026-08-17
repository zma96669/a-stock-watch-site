# Tencent-primary market data

## Goal

Use Tencent Finance as the preferred A-share quote and intraday source while retaining East Money as an automatic, invisible fallback.

## Provider strategy

Add a Tencent provider and a composite fallback provider. Quotes and intraday data fall back independently: a Tencent quote failure does not force a successful Tencent intraday request to be repeated, and vice versa.

For batch quotes, request all watchlist symbols from `qt.gtimg.cn`. Keep valid Tencent rows and request only missing or invalid stocks from East Money. A Tencent quote is valid for this plugin when current price, previous close, and turnover rate are present. Merge fallback rows without replacing valid Tencent rows.

For intraday data, query Tencent's minute endpoint for the current stock. Use Tencent data only when it produces at least one valid standard-session point with cumulative amount data; otherwise request the complete intraday series from East Money.

## Tencent mapping

Decode the Tencent quote response as GBK. Map symbol, name, current price, previous close, change, change percent, total volume, total amount, and turnover rate into the existing domain model.

Tencent minute rows contain time, price, cumulative volume, and cumulative amount. Convert cumulative volume and amount into per-minute deltas for the histogram. Derive the average-price line from cumulative amount divided by cumulative volume times 100 shares per lot. Preserve zero-delta lunch markers for the price path but ignore them naturally in amount bars.

Filter minute rows to `09:30–11:30` and `13:00–15:00`. Reject malformed, decreasing cumulative, non-finite, and negative values. Format timestamps using the response trading date.

## Failure behavior

Each request retains the existing five-second timeout and caller cancellation. If Tencent fails or lacks required fields, fall back to East Money without a popup. If both fail, the existing stale snapshot and exponential retry behavior remains unchanged.

Log the selected source and fallback reason only to the extension development console. Do not add a visible source badge to the stealth UI.

## Verification

Use fixed GBK quote and JSON minute fixtures to test parsing, cumulative deltas, average price, session filtering, partial quote merge, and independent fallback. Keep network access out of the automated test suite. Before packaging, perform one read-only live Tencent quote/minute probe, run all tests, package version `0.1.13`, install it, and deploy a new content-hashed background loader if its content changes.
