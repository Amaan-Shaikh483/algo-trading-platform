import { getServiceClient } from '../supabase/client'
import { HttpError } from '../lib/httpError'
import { recordAuditEvent } from '../supabase/brokerConnectionStore'
import {
  RULE_SCHEMA_VERSION,
  SEGMENTS,
  TIMEFRAMES,
  validateStrategyRules,
} from '@algo/rule-schema'
import type { StrategyRules } from '@algo/rule-schema'
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
  return data
}

function sanitizeRules(rules: unknown): StrategyRules {
  // JSONB round-trip equivalents — no functions should have entered the object.
  return JSON.parse(JSON.stringify(rules)) as StrategyRules
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
  return (strategies ?? []).map((s) => {
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
  assertValidRules(input.rules)
  const rules = sanitizeRules(input.rules)
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
      mode: 'paper', // spec 3.7: new strategies ALWAYS default to paper
      is_active: false,
      version: RULE_SCHEMA_VERSION,
    })
    .select()
    .single()
  if (error) throw new HttpError(500, `Failed to create strategy: ${error.message}`)
  return data
}

export async function updateStrategy(userId: string, id: string, input: StrategyInput): Promise<StrategyRow> {
  const existing = await getOwnedRow(userId, id)
  if (existing.is_active) throw new HttpError(409, 'Deactivate the strategy before editing its rules', 'ACTIVE_LOCKED')
  validateBasics(input)
  assertValidRules(input.rules)
  const rules = sanitizeRules(input.rules)
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
      version: RULE_SCHEMA_VERSION,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new HttpError(500, `Failed to update strategy: ${error.message}`)
  return data
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
      mode: 'paper', // clones always restart in paper mode (spec 3.7 parity)
      is_active: false,
      version: source.version,
    })
    .select()
    .single()
  if (error) throw new HttpError(500, `Failed to clone strategy: ${error.message}`)
  return data
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
