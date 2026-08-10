import { getServiceClient } from '../supabase/client'
import { HttpError } from '../lib/httpError'
import { logger } from '../lib/logger'
import { validateStrategyRules } from '@algo/rule-schema'
import { notify } from './userEvents'
import { getSessionAdapterForUser } from './brokerConnectionService'
import { runBacktestCore } from './engine/backtestEngine'
import type { BacktestConfig, BacktestResult } from './engine/backtestEngine'
import type { Candle } from './brokers/types'
import type { BacktestRunRow } from '../supabase/types'

/**
 * Backtest orchestration (spec §3.5): fetch → replay → store → notify.
 *
 * Async model (per the chosen Edge-Functions/cron infra instead of BullMQ):
 * `backtest_runs` rows ARE the queue. Runs are claimed optimistically
 * (queued → running) and processed in-process right after creation; the
 * 1-minute cron edge function hits /internal/jobs/run-backtests as a sweeper
 * for anything orphaned by a crash/restart. Frontend polls status/progress.
 */

const MAX_SPAN_DAYS = 366 * 2
const MAX_RUNS_PER_DAY = 25

// Verified SmartAPI Historical API max-day-per-call limits (official release
// note) — with a 1-day safety margin applied below.
const MAX_DAYS_PER_CALL: Record<string, number> = {
  '1m': 29, '3m': 59, '5m': 99, '10m': 99, '15m': 199, '30m': 199, '1h': 399, '1D': 1999,
}

export interface BacktestParams {
  strategyId: string
  strategyName: string
  from: string
  to: string
  initialCapital: number
  brokerageType: 'flat' | 'percent'
  brokerageValue: number
  slippagePercent: number
}

export interface CreateBacktestInput {
  strategyId?: unknown
  from?: unknown
  to?: unknown
  initialCapital?: unknown
  brokerageType?: unknown
  brokerageValue?: unknown
  slippagePercent?: unknown
}

function validateInput(body: CreateBacktestInput): Required<Omit<BacktestParams, 'strategyName'>> & { strategyId: string } {
  const strategyId = body.strategyId
  if (typeof strategyId !== 'string' || !strategyId) throw new HttpError(400, 'strategyId is required', 'VALIDATION')

  const from = new Date(body.from as string)
  const to = new Date(body.to as string)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new HttpError(400, 'from/to must be valid dates', 'VALIDATION')
  if (from >= to) throw new HttpError(400, '`from` must be before `to`', 'VALIDATION')
  if (to.getTime() - from.getTime() > MAX_SPAN_DAYS * 86400000) {
    throw new HttpError(400, `Date range is limited to ${MAX_SPAN_DAYS} days`, 'VALIDATION')
  }

  const capital = Number(body.initialCapital)
  if (!Number.isFinite(capital) || capital < 1000 || capital > 100000000) {
    throw new HttpError(400, 'initialCapital must be between ₹1,000 and ₹10 Cr', 'VALIDATION')
  }
  const brokerageType = body.brokerageType === 'percent' ? 'percent' : 'flat'
  const brokerageValue = Number(body.brokerageValue ?? 20)
  if (!Number.isFinite(brokerageValue) || brokerageValue < 0 || brokerageValue > 10000) {
    throw new HttpError(400, 'Invalid brokerage value', 'VALIDATION')
  }
  const slippagePercent = Number(body.slippagePercent ?? 0.05)
  if (!Number.isFinite(slippagePercent) || slippagePercent < 0 || slippagePercent > 5) {
    throw new HttpError(400, 'slippagePercent must be between 0 and 5', 'VALIDATION')
  }
  return { strategyId, from: from.toISOString(), to: to.toISOString(), initialCapital: capital, brokerageType, brokerageValue, slippagePercent }
}

export async function listRuns(userId: string): Promise<Omit<BacktestRunRow, 'result'>[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('backtest_runs')
    .select('id, user_id, strategy_id, params, status, progress, error, created_at, started_at, completed_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new HttpError(500, `Failed to list backtests: ${error.message}`)
  return data as Omit<BacktestRunRow, 'result'>[]
}

export async function getRun(userId: string, id: string): Promise<BacktestRunRow> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('backtest_runs')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) throw new HttpError(404, 'Backtest run not found', 'NOT_FOUND')
  return data
}

export async function deleteRun(userId: string, id: string): Promise<void> {
  const supabase = getServiceClient()
  const { error } = await supabase.from('backtest_runs').delete().eq('id', id).eq('user_id', userId)
  if (error) throw new HttpError(500, `Failed to delete backtest: ${error.message}`)
}

export async function createRun(userId: string, body: CreateBacktestInput): Promise<BacktestRunRow> {
  const input = validateInput(body)
  const supabase = getServiceClient()

  // Fair-use guard (multi-year replays cost real broker-API calls).
  const { count } = await supabase
    .from('backtest_runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - 86400000).toISOString())
  if ((count ?? 0) >= MAX_RUNS_PER_DAY) {
    throw new HttpError(429, `Backtest limit reached (${MAX_RUNS_PER_DAY}/day)`, 'RATE_LIMITED')
  }

  const { data: strategy, error } = await supabase
    .from('strategies')
    .select('*')
    .eq('id', input.strategyId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !strategy) throw new HttpError(404, 'Strategy not found', 'NOT_FOUND')
  const { valid, errors } = validateStrategyRules(strategy.rules)
  if (!valid) throw new HttpError(400, `Strategy rules are invalid: ${errors.join('; ')}`, 'INVALID_RULES')

  const params: BacktestParams = {
    strategyId: strategy.id,
    strategyName: strategy.name,
    from: input.from,
    to: input.to,
    initialCapital: input.initialCapital,
    brokerageType: input.brokerageType,
    brokerageValue: input.brokerageValue,
    slippagePercent: input.slippagePercent,
  }

  const { data: run, error: insertError } = await supabase
    .from('backtest_runs')
    .insert({ user_id: userId, strategy_id: strategy.id, params: params as never, status: 'queued' })
    .select()
    .single()
  if (insertError) throw new HttpError(500, `Failed to queue backtest: ${insertError.message}`)

  // Kick the in-process worker (fire-and-forget; result lands via DB polling).
  void drainQueue()
  return run
}

// ── Historical candle fetching (spec §3.5: chunked + stitched) ──────────────

/** Exported for the standalone strategy diagnostic CLI (src/diagnose.ts). */
export async function fetchHistoricalCandles(
  userId: string,
  opts: { exchange: string; symboltoken: string; interval: string; from: Date; to: Date; onProgress?: (doneChunks: number, totalChunks: number) => void },
): Promise<Candle[]> {
  const { adapter } = await getSessionAdapterForUser(userId) // throws BROKER_NOT_CONNECTED when absent
  const maxDays = MAX_DAYS_PER_CALL[opts.interval] ?? 99
  const chunkMs = maxDays * 86400000

  const chunks: Array<{ from: Date; to: Date }> = []
  for (let cursor = opts.from.getTime(); cursor < opts.to.getTime(); cursor += chunkMs) {
    chunks.push({ from: new Date(cursor), to: new Date(Math.min(cursor + chunkMs, opts.to.getTime())) })
  }

  const byTime = new Map<number, Candle>()
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const candles = await adapter.getCandleData({
      exchange: opts.exchange as never,
      symboltoken: opts.symboltoken,
      interval: opts.interval,
      from: chunk.from,
      to: chunk.to,
    })
    for (const c of candles) byTime.set(c.time.getTime(), c)
    opts.onProgress?.(i + 1, chunks.length)
  }
  return [...byTime.values()].sort((a, b) => a.time.getTime() - b.time.getTime())
}

// ── Queue drain ─────────────────────────────────────────────────────────────

let draining = false

/** Claim+process queued runs sequentially. Idempotent; safe to call from cron. */
export async function drainQueue(): Promise<{ processed: number }> {
  if (draining) return { processed: 0 }
  draining = true
  let processed = 0
  try {
    for (;;) {
      const supabase = getServiceClient()
      const { data: next } = await supabase
        .from('backtest_runs')
        .select('id')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (!next) break

      // Optimistic claim: only one worker flips queued → running.
      const { data: claimed } = await supabase
        .from('backtest_runs')
        .update({ status: 'running', started_at: new Date().toISOString(), progress: 1 })
        .eq('id', next.id)
        .eq('status', 'queued')
        .select()
        .maybeSingle()
      if (!claimed) continue

      await processRun(claimed as BacktestRunRow)
      processed++
    }
  } finally {
    draining = false
  }
  return { processed }
}

async function setProgress(runId: string, progress: number): Promise<void> {
  try {
    await getServiceClient().from('backtest_runs').update({ progress }).eq('id', runId)
  } catch {
    // progress updates are best-effort
  }
}

async function processRun(run: BacktestRunRow): Promise<void> {
  const supabase = getServiceClient()
  const params = run.params as unknown as BacktestParams
  const finish = async (patch: Record<string, unknown>) =>
    supabase.from('backtest_runs').update({ ...patch, completed_at: new Date().toISOString() }).eq('id', run.id)

  try {
    if (!run.strategy_id) throw new Error('Strategy was deleted before the backtest ran')
    const { data: strategy, error } = await supabase.from('strategies').select('*').eq('id', run.strategy_id).maybeSingle()
    if (error || !strategy) throw new Error('Strategy was deleted before the backtest ran')
    const rules = strategy.rules as never as Parameters<typeof runBacktestCore>[0]['rules']

    await setProgress(run.id, 5)
    const candles = await fetchHistoricalCandles(run.user_id, {
      exchange: strategy.exchange,
      symboltoken: strategy.symbol_token,
      interval: strategy.timeframe,
      from: new Date(params.from),
      to: new Date(params.to),
      onProgress: (done, total) => void setProgress(run.id, 5 + Math.round((done / Math.max(total, 1)) * 65)),
    })
    if (candles.length < 30) {
      throw new Error(`Only ${candles.length} candles returned — too few to backtest (check exchange/token/date range)`)
    }

    await setProgress(run.id, 75)
    const config: BacktestConfig = {
      initialCapital: params.initialCapital,
      brokerageType: params.brokerageType,
      brokerageValue: params.brokerageValue,
      slippagePercent: params.slippagePercent,
    }
    const result: BacktestResult = runBacktestCore({ rules, candles, config })

    await finish({ status: 'completed', progress: 100, result: result as never, error: null })
    await notify(run.user_id, 'backtest_completed', `Backtest complete: ${params.strategyName}`, `Net P&L ₹${result.summary.totalNetPnl} over ${result.summary.totalTrades} trades (${candles.length} candles).`)
    logger.info('backtest completed', { runId: run.id, trades: result.summary.totalTrades, candles: candles.length })
  } catch (err) {
    const message = (err as Error).message
    await finish({ status: 'failed', progress: 100, error: message })
    await notify(run.user_id, 'strategy_error', `Backtest failed: ${params.strategyName}`, message)
    logger.error('backtest failed', { runId: run.id, error: message })
  }
}


