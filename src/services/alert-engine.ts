import { randomUUID } from 'node:crypto';
import type { AlertEvent, AlertRule, AlertRuleType, AlertRuleRuntime, IntradayPoint, MarketSnapshot, StockQuote, WatchlistEntry } from '../domain/types';
import { MARKET_INDICES } from '../market/market-indices';
import type { AlertStore } from '../state/alert-store';

const COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_WINDOW_MINUTES = 3;

export class AlertEngine {
  private readonly history = new Map<string, QuoteHistoryPoint[]>();

  constructor(private readonly alerts: AlertStore, private readonly entries: () => readonly WatchlistEntry[], private readonly now: () => Date = () => new Date()) {}

  async evaluate(snapshot: MarketSnapshot): Promise<readonly AlertEvent[]> {
    const now = this.now();
    const timestamp = now.getTime();
    if (!isChinaTradingTime(now) || !isFresh(snapshot, timestamp)) return [];
    this.remember(snapshot, timestamp);
    const rules = this.alerts.getRules().filter((rule) => rule.enabled);
    if (!rules.length) return [];
    const states = this.alerts.getRuleStates();
    const events: AlertEvent[] = [];
    let statesChanged = false;
    for (const rule of rules) {
      const result = this.measure(rule, snapshot, timestamp);
      if (!result) continue;
      const state = states[rule.id] ?? { active: false } satisfies AlertRuleRuntime;
      const preview = previewMeasurement(rule, result);
      if (preview && !result.active) {
        const previewWasActive = Boolean(state.previewActive);
        state.previewActive = true;
        states[rule.id] = state;
        statesChanged ||= !previewWasActive;
        if (!previewWasActive && !this.alerts.isMutedToday(rule.id) && canTrigger(state.previewLastTriggeredAt, timestamp)) {
          const event = createEvent({ ...rule, severity: 'preview' }, preview, now);
          state.previewLastTriggeredAt = event.triggeredAt;
          events.push(event);
          statesChanged = true;
        }
      } else if (state.previewActive) {
        state.previewActive = false;
        statesChanged = true;
      }
      const wasActive = rule.severity === 'preview' ? Boolean(state.previewActive) : state.active;
      if (!result.active) {
        if (rule.severity === 'preview' ? state.previewActive : state.active) {
          if (rule.severity === 'preview') state.previewActive = false;
          else state.active = false;
          statesChanged = true;
        }
        states[rule.id] = state;
        continue;
      }
      if (rule.severity === 'preview') state.previewActive = true;
      else state.active = true;
      states[rule.id] = state;
      statesChanged ||= !wasActive;
      if (wasActive || this.alerts.isMutedToday(rule.id)) continue;
      const lastTriggeredAt = rule.severity === 'preview' ? state.previewLastTriggeredAt : state.lastTriggeredAt;
      if (!canTrigger(lastTriggeredAt, timestamp)) continue;
      const event = createEvent(rule, result, now);
      if (rule.severity === 'preview') state.previewLastTriggeredAt = event.triggeredAt;
      else state.lastTriggeredAt = event.triggeredAt;
      statesChanged = true;
      events.push(event);
    }
    if (statesChanged) await this.alerts.replaceRuleStates(states);
    for (const event of events) await this.alerts.record(event);
    return events;
  }

  clearHistory(): void {
    this.history.clear();
  }

  private remember(snapshot: MarketSnapshot, timestamp: number): void {
    Object.values(snapshot.quotes).forEach((quote) => this.rememberQuote(quote, timestamp));
  }

  private rememberQuote(quote: StockQuote, timestamp: number): void {
    if (quote.price == null || quote.price <= 0) return;
    const points = this.history.get(quote.code) ?? [];
    points.push({ at: timestamp, price: quote.price, amount: quote.amount ?? undefined });
    const cutoff = timestamp - 60 * 60 * 1000;
    this.history.set(quote.code, points.filter((point) => point.at >= cutoff).slice(-180));
  }

  private measure(rule: AlertRule, snapshot: MarketSnapshot, now: number): Measurement | undefined {
    const quote = snapshot.quotes[rule.code];
    const entry = this.entries().find((item) => item.code === rule.code);
    if (!quote || quote.suspended || quote.price == null) return undefined;
    const indexQuote = correspondingIndex(entry, snapshot);
    let value: number | undefined;
    let active = false;
    switch (rule.type) {
      case 'price-above': value = quote.price; active = value >= rule.threshold; break;
      case 'price-below': value = quote.price; active = value <= rule.threshold; break;
      case 'change-rise': value = quote.changePercent ?? undefined; active = value !== undefined && value >= rule.threshold; break;
      case 'change-fall': value = quote.changePercent ?? undefined; active = value !== undefined && value <= -rule.threshold; break;
      case 'holding-profit': value = holdingPercent(entry, quote); active = value !== undefined && value >= rule.threshold; break;
      case 'holding-loss': value = holdingPercent(entry, quote); active = value !== undefined && value <= -rule.threshold; break;
      case 'rapid-rise': value = movementPercent(this.history.get(rule.code), quote.price, now, rule.windowMinutes ?? DEFAULT_WINDOW_MINUTES); active = value !== undefined && value >= rule.threshold; break;
      case 'rapid-fall': value = movementPercent(this.history.get(rule.code), quote.price, now, rule.windowMinutes ?? DEFAULT_WINDOW_MINUTES); active = value !== undefined && value <= -rule.threshold; break;
      case 'volume-ratio': value = quote.volumeRatio ?? undefined; active = value !== undefined && value >= rule.threshold; break;
      case 'amount-spike': value = amountSpike(this.history.get(rule.code), now); active = value !== undefined && value >= rule.threshold; break;
      case 'turnover': value = quote.turnoverRate ?? undefined; active = value !== undefined && value >= rule.threshold; break;
      case 'relative-strength': value = relativeChange(quote, indexQuote); active = value !== undefined && value >= rule.threshold; break;
      case 'relative-weakness': value = relativeChange(quote, indexQuote); active = value !== undefined && value <= -rule.threshold; break;
    }
    if (value === undefined || !Number.isFinite(value)) return undefined;
    return { active, value, title: titleFor(rule.type), unit: unitFor(rule.type), stockName: quote.name };
  }
}

interface QuoteHistoryPoint { at: number; price: number; amount?: number }
interface Measurement { active: boolean; value: number; title: string; unit: string; stockName: string }

function createEvent(rule: AlertRule, result: Measurement, now: Date): AlertEvent {
  return {
    id: randomUUID(), ruleId: rule.id, code: rule.code, stockName: result.stockName, type: rule.type, severity: rule.severity,
    title: `${result.title}提醒`,
    message: `${formatNumber(result.value)}${result.unit}，阈值 ${formatNumber(rule.threshold)}${result.unit}`,
    value: result.value, threshold: rule.threshold, triggeredAt: now.toISOString(), read: false
  };
}

function holdingPercent(entry: WatchlistEntry | undefined, quote: StockQuote): number | undefined {
  if (!entry?.costPrice || entry.costPrice <= 0 || quote.price == null) return undefined;
  return (quote.price - entry.costPrice) / entry.costPrice * 100;
}

function movementPercent(points: QuoteHistoryPoint[] | undefined, price: number, now: number, minutes: number): number | undefined {
  const target = now - minutes * 60 * 1000;
  const previous = points?.filter((point) => point.at <= target).at(-1);
  return previous && previous.price > 0 ? (price - previous.price) / previous.price * 100 : undefined;
}

function amountSpike(points: readonly QuoteHistoryPoint[] | undefined, now: number): number | undefined {
  if (!points?.length) return undefined;
  const boundaries = Array.from({ length: 12 }, (_, index) => now - (11 - index) * 60_000);
  const amounts = boundaries.map((boundary) => points.filter((point) => point.at <= boundary && point.amount !== undefined).at(-1)?.amount);
  const deltas = amounts.slice(1).flatMap((amount, index) => amount !== undefined && amounts[index] !== undefined && amount >= amounts[index]! ? [amount - amounts[index]!] : []);
  if (deltas.length < 2) return undefined;
  const current = deltas.at(-1)!;
  const history = deltas.slice(0, -1).filter((value) => value > 0);
  if (!history.length) return undefined;
  const average = history.reduce((sum, amount) => sum + amount, 0) / history.length;
  return average > 0 ? current / average : undefined;
}

function relativeChange(quote: StockQuote, index: StockQuote | undefined): number | undefined {
  if (quote.changePercent == null || index?.changePercent == null) return undefined;
  return quote.changePercent - index.changePercent;
}

function correspondingIndex(entry: WatchlistEntry | undefined, snapshot: MarketSnapshot): StockQuote | undefined {
  const key = entry?.market === 'SH' ? 'sh000001' : entry?.code.startsWith('300') ? 'sz399006' : 'sz399001';
  return snapshot.indexQuotes[key];
}

function previewMeasurement(rule: AlertRule, measurement: Measurement): Measurement | undefined {
  if ((rule.type !== 'price-above' && rule.type !== 'price-below') || !rule.proximityPercent || rule.proximityPercent <= 0) return undefined;
  const distance = Math.abs(measurement.value - rule.threshold) / rule.threshold * 100;
  return distance <= rule.proximityPercent ? { ...measurement, active: true, title: '接近目标价' } : undefined;
}

function canTrigger(lastTriggeredAt: string | undefined, now: number): boolean {
  return !lastTriggeredAt || now - Date.parse(lastTriggeredAt) >= COOLDOWN_MS;
}

function isFresh(snapshot: MarketSnapshot, now: number): boolean {
  const timestamp = snapshot.quoteUpdatedAt ?? snapshot.updatedAt;
  return Boolean(timestamp && Number.isFinite(Date.parse(timestamp)) && now - Date.parse(timestamp) <= 2 * 60_000);
}

export function isChinaTradingTime(date: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const field = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = field('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = Number(field('hour')) * 60 + Number(field('minute'));
  return (minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30) || (minutes >= 13 * 60 && minutes <= 15 * 60);
}

function titleFor(type: AlertRuleType): string {
  return {
    'price-above': '价格突破', 'price-below': '价格跌破', 'change-rise': '涨幅达到', 'change-fall': '跌幅达到',
    'holding-profit': '持仓盈利达到', 'holding-loss': '持仓亏损达到', 'rapid-rise': '快速上涨', 'rapid-fall': '快速下跌',
    'volume-ratio': '量比', 'amount-spike': '分钟放量', turnover: '换手率', 'relative-strength': '相对大盘强势', 'relative-weakness': '相对大盘弱势'
  }[type];
}

function unitFor(type: AlertRuleType): string {
  return type === 'price-above' || type === 'price-below' ? '' : type === 'volume-ratio' || type === 'amount-spike' ? '倍' : '%';
}

function formatNumber(value: number): string {
  return Number(value).toFixed(2);
}
