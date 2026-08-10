import { getServiceClient } from '../supabase/client'
import type { BrokerFunds, BrokerHolding, BrokerPosition, LtpQuote } from './brokers/types'
import { getSessionAdapterForUser } from './brokerConnectionService'

/**
 * Dashboard read-model (spec §3.8).
 *
 * The engine's own tables (orders/positions/trade_logs) are the system of
 * record and arrive client-side via Supabase Realtime; broker-side reads
 * (quotes, position/holding book, funds) go through the user's session with
 * the shared per-user rate limiters plus short in-process caches so a busy
 * dashboard can't stampede the broker API (§2.2).
 */

// ── engine tables (system of record) ────────────────────────────────────────

export async function getDashboardPositions(userId: string): Promise<{ open: unknown[]; closedToday: unknown[] }> {
  const supabase = getServiceClient()
  const istStart = istDayStartIso()
  const [open, closedToday] = await Promise.all([
    supabase.from('positions').select('*').eq('user_id', userId).eq('status', 'open').order('opened_at', { ascending: false }),
    supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'closed')
      .gte('closed_at', istStart)
      .order('closed_at', { ascending: false }),
  ])
  if (open.error) throw new Error(open.error.message)
  if (closedToday.error) throw new Error(closedToday.error.message)
  return { open: open.data ?? [], closedToday: closedToday.data ?? [] }
}

export async function getDashboardOrders(userId: string, limit: number): Promise<unknown[]> {
  const { data, error } = await getServiceClient()
    .from('orders')
    .select('*')
    .eq('user_id', userId)
    .order('placed_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getDashboardTrades(userId: string, limit: number): Promise<unknown[]> {
  const { data, error } = await getServiceClient()
    .from('trade_logs')
    .select('*')
    .eq('user_id', userId)
    .order('exit_time', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getTodayRealized(userId: string): Promise<{ paper: number; live: number }> {
  const { data, error } = await getServiceClient()
    .from('trade_logs')
    .select('pnl, mode')
    .eq('user_id', userId)
    .gte('exit_time', istDayStartIso())
  if (error) throw new Error(error.message)
  let paper = 0
  let live = 0
  for (const row of data ?? []) {
    if (row.mode === 'live') live += Number(row.pnl)
    else paper += Number(row.pnl)
  }
  return { paper: round2(paper), live: round2(live) }
}

function istDayStartIso(): string {
  const d = new Date()
  d.setUTCHours(18, 30, 0, 0) // 00:00 IST == 18:30 UTC previous day
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString()
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

// ── quotes (REST snapshot cache; WS context arrives via the worker for engine symbols) ──

const QUOTE_CACHE_TTL_MS = 5_000
const quoteCache = new Map<string, { at: number; quotes: LtpQuote[] }>()

export async function getQuotes(
  userId: string,
  items: { exchange: string; token: string }[],
  mode: 'LTP' | 'OHLC' | 'FULL',
): Promise<LtpQuote[]> {
  const key = `${userId}|${mode}|${items.map((i) => `${i.exchange}:${i.token}`).sort().join(',')}`
  const cached = quoteCache.get(key)
  if (cached && Date.now() - cached.at < QUOTE_CACHE_TTL_MS) return cached.quotes

  const { adapter } = await getSessionAdapterForUser(userId)
  const byExchange: Record<string, string[]> = {}
  for (const item of items) {
    byExchange[item.exchange] ??= []
    if (byExchange[item.exchange].length < 50) byExchange[item.exchange].push(item.token)
  }
  const quotes = Object.keys(byExchange).length > 0 ? await adapter.getLTP(byExchange, mode) : []
  quoteCache.set(key, { at: Date.now(), quotes })
  return quotes
}

// ── broker book (positions + holdings + funds), 20s cache, force-refresh supported ──

const BROKER_BOOK_TTL_MS = 20_000
const brokerBookCache = new Map<string, { at: number; value: BrokerBook }>()

export interface BrokerBook {
  positions: BrokerPosition[]
  holdings: BrokerHolding[]
  funds: BrokerFunds | null
  syncedAt: string
}

export async function getBrokerBook(userId: string, forceRefresh: boolean): Promise<BrokerBook> {
  const cached = brokerBookCache.get(userId)
  if (!forceRefresh && cached && Date.now() - cached.at < BROKER_BOOK_TTL_MS) return cached.value
  const { adapter } = await getSessionAdapterForUser(userId)
  const [positions, holdings, funds] = await Promise.all([
    adapter.getPositions().catch(() => [] as BrokerPosition[]),
    adapter.getHoldings().catch(() => [] as BrokerHolding[]),
    adapter.getRMS().catch(() => null),
  ])
  const value: BrokerBook = { positions, holdings, funds, syncedAt: new Date().toISOString() }
  brokerBookCache.set(userId, { at: Date.now(), value })
  return value
}
