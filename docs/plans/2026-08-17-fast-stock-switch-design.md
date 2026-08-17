# Fast stock switching and split refresh cadence

## Goal

Make status prices more current and make background charts switch immediately without increasing full intraday traffic unnecessarily.

## Refresh cadence

Split the current combined refresh loop into two independent loops:

- Batch quotes refresh every 2 seconds by default. This updates current price, change percent, turnover rate, and watchlist rows through one lightweight Tencent request.
- The selected stock's full intraday series refreshes every 5 seconds. Tencent returns the complete trading-day minute payload, so polling it at quote frequency would mostly transfer duplicate data.

Retain manual refresh as a combined quote and current-intraday refresh. Preserve exponential backoff independently for quote and intraday failures. Tencent remains primary and East Money remains the per-operation fallback.

## Immediate switching

Maintain an in-memory intraday cache by stock code. When current stock changes:

1. Abort the previous stock's intraday request.
2. Increment an intraday request generation number.
3. Immediately publish the newly selected code with its cached intraday series, or an empty series when no cache exists. Never leave the previous stock's chart visible under the new status-bar selection.
4. Start a new intraday request immediately, independent of any quote request already in flight.
5. Apply the result only if its generation and stock code still match the latest selection.

Rapid repeated switching therefore keeps only the last selection. A late response from an aborted request cannot overwrite the active chart.

## Trigger cleanup

Use `current.onDidChange` as the single stock-switch trigger. Remove duplicate explicit refresh calls from select, rotate, add, and remove paths where the current-store event already starts the work. Tree refresh remains immediate.

## Configuration

Change `aStockWatch.refreshInterval` to the quote interval, default `2` seconds with a minimum of `1`. Add `aStockWatch.intradayRefreshInterval`, default `5` seconds with a minimum of `3`. Existing explicit quote interval values remain respected.

## Verification

Use controllable providers to test immediate cached publication, empty publication for uncached stocks, cancellation, late-response rejection, rapid switching, independent polling, and manual combined refresh. Run the complete suite, benchmark live Tencent requests once, package version `0.1.14`, install it, and reuse the current background loader hash when its script content is unchanged.
