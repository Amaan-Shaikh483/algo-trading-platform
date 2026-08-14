import { getServiceClient } from '../supabase/client'
import { HttpError } from '../lib/httpError'
import { recordAuditEvent } from '../supabase/brokerConnectionStore'
import {
  RULE_SCHEMA_VERSION,
  SEGMENTS,
  TIMEFRAMES,
  normalizeOrderType,
  normalizeRiskManagement,
  productTypeForOrderType,
  validateStrategyRules,
} from '@algo/rule-schema'
import type { OrderTypeConfig, RiskManagementConfig, StrategyRules } from '@algo/rule-schema'
import type { StrategyRow } from '../supabase/types'

/**
 * Strategy CRUD + lifecycle (spec 3.4): create/update/delete/clone/toggle with
 * the versioned rule schema enforced on every write. Engine-agnostic — this is
 * the control plane; paper/live execution lands in step 7 behind the Risk
 * Manager.
 */

export interface StrategyInput {
  name: string
  description?: string
  instrument: string
  symbolToken: string
  exchange: string
  segment: string
  timeframe: string
  rules: StrategyRules
  /**
   * Optional top-level Order Type / Risk Management blocks. The builder sends
   * them inside `rules` (single source of truth for the engines); accepting
   * them at the payload root too keeps the documented API shape usable by
   * external clients. When both are present the top-level block wins.
   */
  orderType?: OrderTypeConfig
  riskManagement?: RiskManagementConfig
}

/** Fold optional top-level blocks into the rule tree before validation. */
function mergeConfigBlocks(input: StrategyInput): StrategyRules {
  const rules = (input.rules ?? {}) as StrategyRules
  return {
    ...rules,
    ...(input.orderType != null ? { orderType: input.orderType } : {}),
    ...(input.riskManagement != null ? { riskManagement: input.riskManagement } : {}),
  }
}

export interface StrategyListItem extends StrategyRow {
  perf: {
    total_pnl: number
    today_pnl: number
    total_trades: number
    win_rate: number
    last_exit_time: string | null
  }
}

function validateBasics(b: Partial<StrategyInput>): void {
  if (!b.name?.trim()) throw new HttpError(400, 'Strategy name is required', 'VALIDATION')
  if (b.instrument !== undefined && !b.instrument.trim()) throw new HttpError(400, 'Instrument is required', 'VALIDATION')
  if (b.symbolToken !== undefined && !b.symbolToken.trim()) throw new HttpError(400, 'Instrument token is required', 'VALIDATION')
  if (b.exchange !== undefined && !b.exchange.trim()) throw new HttpError(400, 'Exchange is required', 'VALIDATION')
  if (b.segment !== undefined && !(SEGMENTS as readonly string[]).includes(b.segment)) {
    throw new HttpError(400, `Segment must be one of ${SEGMENTS.join(', ')}`, 'VALIDATION')
  }
  if (b.timeframe !== undefined && !(TIMEFRAMES as readonly string[]).includes(b.timeframe)) {
    throw new HttpError(400, `Timeframe must be one of ${TIMEFRAMES.join(', ')}`, 'VALIDATION')
  }
}

function assertValidRules(rules: unknown): asserts rules is StrategyRules {
  const { valid, errors } = validateStrategyRules(rules)
  if (!valid) throw new HttpError(400, `Invalid strategy rules: ${errors.join('; ')}`, 'INVALID_RULES')
}

/**
 * Backward compatibility on READ: strategies saved before the Order Type /
 * Risk Management feature have no `orderType` / `riskManagement` blocks (and
 * no mirrored columns). Rather than 500-ing or handing the builder a hole, we
 * derive both from the legacy fields (product type, exit.timeSquareOff,
 * exit.overallProfit/LossAmount) so editing an old strategy opens with correct
 * values. This is a pure read-time projection — nothing is written back until
 * the user saves.
 */
function hydrateRow(row: StrategyRow): StrategyRow {
  const rules = (row.rules ?? {}) as Partial<StrategyRules>
  const orderType = normalizeOrderType(rules)
  const riskManagement = normalizeRiskManagement(rules)
  return {
    ...row,
    rules: { ...(rules as object), orderType, riskManagement } as never,
    order_type: (row.order_type ?? orderType) as never,
    risk_management: (row.risk_management ?? riskManagement) as never,
  }
}

async function getOwnedRow(userId: string, id: string): Promise<StrategyRow> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('strategies')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new HttpError(500, `Failed to load strategy: ${error.message}`)
  if (!data) throw new HttpError(404, 'Strategy not found', 'NOT_FOUND')
  return hydrateRow(data)
}

function sanitizeRules(rules: unknown): StrategyRules {
  // JSONB round-trip equivalents — no functions should have entered the object.
  const parsed = JSON.parse(JSON.stringify(rules)) as StrategyRules
  // Order Type + Risk Management are normalized on write so that:
  //   * strategies saved before the feature existed gain sensible defaults
  //     derived from their legacy fields instead of failing to load, and
  //   * the persisted blob is always canonical (times validated, CNC days
  //     clamped to 0…4, trailing fields pruned to the selected mode).
  const orderType = normalizeOrderType(parsed)
  const riskManagement = normalizeRiskManagement(parsed)
  return {
    ...parsed,
    orderType,
    riskManagement,
    // Keep the broker-facing product type in step with the chosen order type.
    entry: { ...parsed.entry, productType: productTypeForOrderType(orderType.type) },
  }
}

export async function listStrategies(userId: string): Promise<StrategyListItem[]> {
  const supabase = getServiceClient()
  const [{ data: strategies, error }, { data: perf, error: perfError }] = await Promise.all([
    supabase.from('strategies').select('*').eq('user_id', userId).order('updated_at', { ascending: false }),
    supabase.from('strategy_perf').select('*').eq('user_id', userId),
  ])
  if (error) throw new HttpError(500, `Failed to list strategies: ${error.message}`)
  if (perfError) throw new HttpError(500, `Failed to load strategy performance: ${perfError.message}`)
  const perfById = new Map((perf ?? []).map((p) => [p.strategy_id, p]))
  return (strategies ?? []).map((raw) => {
    const s = hydrateRow(raw)
    const p = perfById.get(s.id)
    return {
      ...s,
      perf: {
        total_pnl: Number(p?.total_pnl ?? 0),
        today_pnl: Number(p?.today_pnl ?? 0),
        total_trades: Number(p?.total_trades ?? 0),
        win_rate: Number(p?.win_rate ?? 0),
        last_exit_time: p?.last_exit_time ?? null,
      },
    }
  })
}

export async function getStrategy(userId: string, id: string): Promise<StrategyRow> {
  return getOwnedRow(userId, id)
}

export async function createStrategy(userId: string, input: StrategyInput): Promise<StrategyRow> {
  validateBasics(input)
  const merged = mergeConfigBlocks(input)
  assertValidRules(merged)
  const rules = sanitizeRules(merged)
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('strategies')
    .insert({
      user_id: userId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      instrument: input.instrument.trim(),
      symbol_token: input.symbolToken.trim(),
      exchange: input.exchange.trim(),
      segment: input.segment as StrategyRow['segment'],
      timeframe: input.timeframe,
      rules: rules as never,
      risk_settings: rules.risk as never,
      long_entry_conditions: (rules.longEntryConditions as never) ?? null,
      short_entry_conditions: (rules.shortEntryConditions as never) ?? null,
      legs: (rules.legs as never) ?? null,
      order_type: (rules.orderType as never) ?? null,
      risk_management: (rules.riskManagement as never) ?? null,
      mode: 'paper', // spec 3.7: new strategies ALWAYS default to paper
      is_active: false,
      version: RULE_SCHEMA_VERSION,
    })
    .select()
    .single()
  if (error) throw new HttpError(500, `Failed to create strategy: ${error.message}`)
  return hydrateRow(data)
}

export async function updateStrategy(userId: string, id: string, input: StrategyInput): Promise<StrategyRow> {
  const existing = await getOwnedRow(userId, id)
  if (existing.is_active) throw new HttpError(409, 'Deactivate the strategy before editing its rules', 'ACTIVE_LOCKED')
  validateBasics(input)
  const merged = mergeConfigBlocks(input)
  assertValidRules(merged)
  const rules = sanitizeRules(merged)
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('strategies')
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      instrument: input.instrument.trim(),
      symbol_token: input.symbolToken.trim(),
      exchange: input.exchange.trim(),
      segment: input.segment as StrategyRow['segment'],
      timeframe: input.timeframe,
      rules: rules as never,
      risk_settings: rules.risk as never,
      long_entry_conditions: (rules.longEntryConditions as never) ?? null,
      short_entry_conditions: (rules.shortEntryConditions as never) ?? null,
      legs: (rules.legs as never) ?? null,
      order_type: (rules.orderType as never) ?? null,
      risk_management: (rules.riskManagement as never) ?? null,
      version: RULE_SCHEMA_VERSION,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new HttpError(500, `Failed to update strategy: ${error.message}`)
  return hydrateRow(data)
}

export async function cloneStrategy(userId: string, id: string): Promise<StrategyRow> {
  const source = await getOwnedRow(userId, id)
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('strategies')
    .insert({
      user_id: userId,
      name: `${source.name} (copy)`,
      description: source.description,
      instrument: source.instrument,
      symbol_token: source.symbol_token,
      exchange: source.exchange,
      segment: source.segment,
      timeframe: source.timeframe,
      rules: source.rules as never,
      risk_settings: source.risk_settings as never,
      long_entry_conditions: source.long_entry_conditions as never,
      short_entry_conditions: source.short_entry_conditions as never,
      legs: source.legs as never,
      order_type: source.order_type as never,
      risk_management: source.risk_management as never,
      mode: 'paper', // clones always restart in paper mode (spec 3.7 parity)
      is_active: false,
      version: source.version,
    })
    .select()
    .single()
  if (error) throw new HttpError(500, `Failed to clone strategy: ${error.message}`)
  return hydrateRow(data)
}

export async function deleteStrategy(userId: string, id: string): Promise<void> {
  const existing = await getOwnedRow(userId, id)
  if (existing.is_active) throw new HttpError(409, 'Deactivate the strategy before deleting it', 'ACTIVE_LOCKED')
  const supabase = getServiceClient()
  const { error } = await supabase.from('strategies').delete().eq('id', id)
  if (error) throw new HttpError(500, `Failed to delete strategy: ${error.message}`)
}

export async function setActive(userId: string, id: string, active: boolean): Promise<StrategyRow> {
  const existing = await getOwnedRow(userId, id)
  if (active) {
    assertValidRules(existing.rules)
    if (existing.mode === 'live') {
      // Spec 3.7 defense-in-depth: live strategies require account-level risk
      // limits configured; the Risk Manager (step 9) enforces them per order.
      const supabase = getServiceClient()
      const { data: risk } = await supabase
        .from('user_risk_settings')
        .select('max_daily_loss')
        .eq('user_id', userId)
        .maybeSingle()
      if (risk?.max_daily_loss == null) {
        throw new HttpError(
          400,
          'Set your account risk limits (max daily loss) before activating a live strategy',
          'RISK_LIMITS_REQUIRED',
        )
      }
    }
  }
  const supabase = getServiceClient()
  const { data, error } = await supabase.from('strategies').update({ is_active: active }).eq('id', id).select().single()
  if (error) throw new HttpError(500, `Failed to update strategy: ${error.message}`)
  await recordAuditEvent(userId, active ? 'strategy.activated' : 'strategy.deactivated', {
    strategyId: id,
    mode: existing.mode,
    name: existing.name,
  })
  return data
}

export async function setMode(userId: string, id: string, mode: 'paper' | 'live', confirm: unknown): Promise<StrategyRow> {
  if (mode !== 'paper' && mode !== 'live') throw new HttpError(400, "mode must be 'paper' or 'live'", 'VALIDATION')
  const existing = await getOwnedRow(userId, id)
  if (mode === 'live') {
    // Spec 3.7: explicit confirmation + account risk limits in effect.
    if (confirm !== true) throw new HttpError(400, 'Live mode requires explicit risk confirmation', 'CONFIRM_REQUIRED')
    const supabase = getServiceClient()
    const { data: risk } = await supabase
      .from('user_risk_settings')
      .select('max_daily_loss')
      .eq('user_id', userId)
      .maybeSingle()
    if (risk?.max_daily_loss == null) {
      throw new HttpError(400, 'Set your account risk limits (max daily loss) before going live', 'RISK_LIMITS_REQUIRED')
    }
  }
  // Mode switches always deactivate — the user re-activates deliberately.
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('strategies')
    .update({ mode, is_active: false })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new HttpError(500, `Failed to update mode: ${error.message}`)
  await recordAuditEvent(userId, 'strategy.mode_changed', { strategyId: id, mode })
  return data
}
