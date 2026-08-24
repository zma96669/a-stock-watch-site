import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { AlertEvent, AlertRule, AlertRuleRuntime, AlertRuleType, AlertRuntimeData, AlertSeverity } from '../domain/types';

const RULES_KEY = 'aStockWatch.alerts.rules';
const RUNTIME_KEY = 'aStockWatch.alerts.runtime';
const MAX_EVENTS = 300;

export interface NewAlertRule {
  code: string;
  type: AlertRuleType;
  threshold: number;
  windowMinutes?: number;
  proximityPercent?: number;
  severity?: AlertSeverity;
}

export class AlertStore implements vscode.Disposable {
  private rules: AlertRule[];
  private runtime: AlertRuntimeData;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly state: vscode.Memento, private readonly now: () => Date = () => new Date()) {
    this.rules = parseRules(state.get<unknown>(RULES_KEY));
    this.runtime = parseRuntime(state.get<unknown>(RUNTIME_KEY), chinaDateKey(now()));
  }

  getRules(): readonly AlertRule[] {
    return this.rules.map((rule) => ({ ...rule }));
  }

  getRulesForCode(code: string): readonly AlertRule[] {
    return this.getRules().filter((rule) => rule.code === code);
  }

  getRule(id: string): AlertRule | undefined {
    const rule = this.rules.find((item) => item.id === id);
    return rule ? { ...rule } : undefined;
  }

  async create(input: NewAlertRule): Promise<AlertRule> {
    validateNewRule(input);
    const timestamp = this.now().toISOString();
    const rule: AlertRule = {
      id: randomUUID(),
      code: input.code,
      type: input.type,
      threshold: input.threshold,
      ...(input.windowMinutes !== undefined ? { windowMinutes: input.windowMinutes } : {}),
      ...((input.proximityPercent !== undefined || input.type === 'price-above' || input.type === 'price-below') ? { proximityPercent: input.proximityPercent ?? 0.5 } : {}),
      severity: input.severity ?? defaultSeverity(input.type),
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.rules = [...this.rules, rule];
    await this.persistRules();
    return { ...rule };
  }

  async update(id: string, patch: Partial<Pick<AlertRule, 'threshold' | 'windowMinutes' | 'proximityPercent' | 'severity' | 'enabled'>>): Promise<void> {
    const existing = this.rules.find((rule) => rule.id === id);
    if (!existing) return;
    const next = { ...existing, ...patch, updatedAt: this.now().toISOString() };
    validateRule(next);
    this.rules = this.rules.map((rule) => rule.id === id ? next : rule);
    await this.persistRules();
  }

  async toggle(id: string): Promise<void> {
    const rule = this.rules.find((item) => item.id === id);
    if (rule) await this.update(id, { enabled: !rule.enabled });
  }

  async remove(id: string): Promise<void> {
    if (!this.rules.some((rule) => rule.id === id)) return;
    this.rules = this.rules.filter((rule) => rule.id !== id);
    delete this.runtime.ruleStates[id];
    this.runtime.mutedRuleIds = this.runtime.mutedRuleIds.filter((ruleId) => ruleId !== id);
    await Promise.all([this.state.update(RULES_KEY, this.rules), this.state.update(RUNTIME_KEY, this.runtime)]);
    this.emitter.fire();
  }

  async replaceRules(rules: readonly AlertRule[]): Promise<void> {
    this.rules = parseRules(rules);
    const ids = new Set(this.rules.map((rule) => rule.id));
    this.runtime.ruleStates = Object.fromEntries(Object.entries(this.runtime.ruleStates).filter(([id]) => ids.has(id)));
    this.runtime.mutedRuleIds = this.runtime.mutedRuleIds.filter((id) => ids.has(id));
    await Promise.all([this.state.update(RULES_KEY, this.rules), this.state.update(RUNTIME_KEY, this.runtime)]);
    this.emitter.fire();
  }

  getEvents(): readonly AlertEvent[] {
    this.ensureToday();
    return this.runtime.events.map((event) => ({ ...event }));
  }

  unreadCount(): number {
    return this.getEvents().filter((event) => !event.read).length;
  }

  async record(event: AlertEvent): Promise<void> {
    this.ensureToday();
    this.runtime.events = [{ ...event }, ...this.runtime.events.filter((item) => item.id !== event.id)].slice(0, MAX_EVENTS);
    await this.persistRuntime();
  }

  async markRead(id?: string): Promise<void> {
    this.ensureToday();
    let changed = false;
    this.runtime.events = this.runtime.events.map((event) => {
      if (event.read || (id && event.id !== id)) return event;
      changed = true;
      return { ...event, read: true };
    });
    if (changed) await this.persistRuntime();
  }

  isMutedToday(ruleId: string): boolean {
    this.ensureToday();
    return this.runtime.mutedRuleIds.includes(ruleId);
  }

  async muteToday(ruleId: string): Promise<void> {
    this.ensureToday();
    if (this.runtime.mutedRuleIds.includes(ruleId)) return;
    this.runtime.mutedRuleIds = [...this.runtime.mutedRuleIds, ruleId];
    await this.persistRuntime();
  }

  getRuleStates(): Record<string, AlertRuleRuntime> {
    this.ensureToday();
    return Object.fromEntries(Object.entries(this.runtime.ruleStates).map(([id, value]) => [id, { ...value }]));
  }

  async replaceRuleStates(states: Record<string, AlertRuleRuntime>): Promise<void> {
    this.ensureToday();
    if (JSON.stringify(states) === JSON.stringify(this.runtime.ruleStates)) return;
    this.runtime.ruleStates = Object.fromEntries(Object.entries(states).map(([id, value]) => [id, { ...value }]));
    await this.persistRuntime(false);
  }

  private ensureToday(): void {
    const today = chinaDateKey(this.now());
    if (this.runtime.tradingDate === today) return;
    this.runtime = emptyRuntime(today);
    void this.state.update(RUNTIME_KEY, this.runtime);
    this.emitter.fire();
  }

  private async persistRules(): Promise<void> {
    await this.state.update(RULES_KEY, this.rules);
    this.emitter.fire();
  }

  private async persistRuntime(emit = true): Promise<void> {
    await this.state.update(RUNTIME_KEY, this.runtime);
    if (emit) this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

export function defaultSeverity(type: AlertRuleType): AlertSeverity {
  return ['price-above', 'price-below', 'holding-profit', 'holding-loss'].includes(type) ? 'important' : 'normal';
}

export function chinaDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function emptyRuntime(tradingDate: string): AlertRuntimeData {
  return { tradingDate, events: [], mutedRuleIds: [], ruleStates: {} };
}

function parseRules(value: unknown): AlertRule[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    try {
      const rule = item as AlertRule;
      validateRule(rule);
      if (seen.has(rule.id)) return [];
      seen.add(rule.id);
      return [{ ...rule }];
    } catch {
      return [];
    }
  });
}

function parseRuntime(value: unknown, today: string): AlertRuntimeData {
  const raw = value as Partial<AlertRuntimeData> | undefined;
  if (!raw || raw.tradingDate !== today) return emptyRuntime(today);
  const events = Array.isArray(raw.events) ? raw.events.filter(isEvent).slice(0, MAX_EVENTS).map((event) => ({ ...event })) : [];
  const mutedRuleIds = Array.isArray(raw.mutedRuleIds) ? raw.mutedRuleIds.filter((id): id is string => typeof id === 'string') : [];
  const states = raw.ruleStates && typeof raw.ruleStates === 'object' && !Array.isArray(raw.ruleStates)
    ? Object.fromEntries(Object.entries(raw.ruleStates).filter((entry): entry is [string, AlertRuleRuntime] => isRuntime(entry[1])).map(([id, state]) => [id, { ...state }]))
    : {};
  return { tradingDate: today, events, mutedRuleIds: [...new Set(mutedRuleIds)], ruleStates: states };
}

function validateNewRule(rule: NewAlertRule): void {
  if (!/^\d{6}$/.test(rule.code)) throw new Error('提醒股票代码无效');
  if (!isRuleType(rule.type)) throw new Error('提醒类型无效');
  if (!Number.isFinite(rule.threshold) || rule.threshold <= 0) throw new Error('提醒阈值必须大于 0');
  if (rule.windowMinutes !== undefined && (!Number.isFinite(rule.windowMinutes) || rule.windowMinutes < 1 || rule.windowMinutes > 60)) throw new Error('提醒时间窗口无效');
  if (rule.proximityPercent !== undefined && (!Number.isFinite(rule.proximityPercent) || rule.proximityPercent < 0 || rule.proximityPercent > 20)) throw new Error('接近目标的百分比无效');
  if (rule.severity !== undefined && !isSeverity(rule.severity)) throw new Error('提醒等级无效');
}

function validateRule(rule: AlertRule): void {
  validateNewRule(rule);
  if (typeof rule.id !== 'string' || !rule.id) throw new Error('提醒 ID 无效');
  if (typeof rule.enabled !== 'boolean') throw new Error('提醒启用状态无效');
  if (!isSeverity(rule.severity)) throw new Error('提醒等级无效');
  if (!validDate(rule.createdAt) || !validDate(rule.updatedAt)) throw new Error('提醒时间无效');
}

function isEvent(value: unknown): value is AlertEvent {
  const event = value as Partial<AlertEvent> | undefined;
  return Boolean(event && typeof event.id === 'string' && typeof event.ruleId === 'string' && /^\d{6}$/.test(event.code ?? '')
    && typeof event.stockName === 'string' && isRuleType(event.type) && isSeverity(event.severity)
    && typeof event.title === 'string' && typeof event.message === 'string' && Number.isFinite(event.value)
    && Number.isFinite(event.threshold) && validDate(event.triggeredAt) && typeof event.read === 'boolean');
}

function isRuntime(value: unknown): value is AlertRuleRuntime {
  const state = value as Partial<AlertRuleRuntime> | undefined;
  return Boolean(state && typeof state.active === 'boolean'
    && (state.previewActive === undefined || typeof state.previewActive === 'boolean')
    && (state.lastTriggeredAt === undefined || validDate(state.lastTriggeredAt))
    && (state.previewLastTriggeredAt === undefined || validDate(state.previewLastTriggeredAt)));
}

function isRuleType(value: unknown): value is AlertRuleType {
  return typeof value === 'string' && ['price-above', 'price-below', 'change-rise', 'change-fall', 'holding-profit', 'holding-loss', 'rapid-rise', 'rapid-fall', 'volume-ratio', 'amount-spike', 'turnover', 'relative-strength', 'relative-weakness'].includes(value);
}

function isSeverity(value: unknown): value is AlertSeverity {
  return value === 'preview' || value === 'normal' || value === 'important';
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
