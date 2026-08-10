import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ArrowDownRight, ArrowUpRight, Pause, Play, Plus, RefreshCw, Server, TrendingUp } from 'lucide-react'
import { Alert, Badge, Button, Card, Modal } from '../components/ui'
import { brokerApi } from '../lib/brokerApi'
import type { BrokerStatusView } from '../lib/brokerApi'
import { dashboardApi } from '../lib/dashboardApi'
import type { BrokerBookView, LiveStatusView, OrderRowView, PositionRowView, QuoteView, TradeLogRowView } from '../lib/dashboardApi'
import { riskApi } from '../lib/riskApi'
import { appMeta } from '../lib/appMeta'
import type { RiskCounter, RiskSettings } from '../lib/riskApi'
import { strategyApi } from '../lib/strategyApi'
import type { StrategyListItem } from '../lib/strategyApi'
import { searchInstruments } from '../lib/instrumentApi'
import { useRealtimeTables } from '../lib/realtime'
import { supabase } from '../lib/supabaseClient'
import { fmtTimeIST, inr, pct, pnlTone } from '../lib/format'

/* ══════════════════════ small shared bits ══════════════════════ */

const quoteKey = (exchange: string, token: string) => `${exchange}:${token}`

function StatusDot({ online }: { online: boolean | null }) {
  return (
    <span className={`h-2 w-2 rounded-full ${online == null ? 'bg-gray-300' : online ? 'bg-emerald-500' : 'bg-gray-400'}`} />
  )
}

type BadgeTone = 'green' | 'yellow' | 'red' | 'gray' | 'blue'
function OrderStatusBadge({ status }: { status: string }) {
  const tone: BadgeTone =
    status === 'complete' ? 'green' : status === 'rejected' ? 'red' : status === 'blocked' ? 'yellow' : status === 'cancelled' ? 'gray' : 'blue'
  return <Badge tone={tone}>{status}</Badge>
}

/* ══════════════════════ market strip ══════════════════════ */

interface IndexChipDef {
  label: string
  query: string
  match: (symbol: string, name: string | null) => boolean
  preferExchange: string
}
const INDICES: IndexChipDef[] = [
  { label: 'NIFTY 50', query: 'Nifty 50', match: (s, n) => s === 'Nifty 50' || n === 'Nifty 50' || n === 'Nifty 50 Index', preferExchange: 'NSE' },
  { label: 'NIFTY BANK', query: 'Nifty Bank', match: (s, n) => s === 'Nifty Bank' || n === 'Nifty Bank', preferExchange: 'NSE' },
  { label: 'SENSEX', query: 'SENSEX', match: (s, n) => s === 'SENSEX' || (n ?? '').includes('SENSEX'), preferExchange: 'BSE' },
]

function MarketStrip({ broker }: { broker: BrokerStatusView | null }) {
  const [tokens, setTokens] = useState<Record<string, { exchange: string; token: string } | null> | null>(null)
  const [quotes, setQuotes] = useState<Map<string, QuoteView>>(new Map())

  // Resolve index tokens from the cached instruments table (no hardcoded tokens).
  useEffect(() => {
    if (broker?.status !== 'connected') return
    void (async () => {
      const resolved: Record<string, { exchange: string; token: string } | null> = {}
      for (const idx of INDICES) {
        try {
          const hits = await searchInstruments(idx.query)
          const hit = hits.find((h) => idx.match(h.symbol, h.name)) ?? hits.find((h) => h.exchange === idx.preferExchange)
          resolved[idx.label] = hit ? { exchange: hit.exchange, token: hit.token } : null
        } catch {
          resolved[idx.label] = null
        }
      }
      setTokens(resolved)
    })()
  }, [broker?.status])

  useEffect(() => {
    if (!tokens) return
    const items = Object.values(tokens).filter((t): t is { exchange: string; token: string } => t != null)
    if (items.length === 0) return
    const load = () =>
      dashboardApi
        .quotes(items, 'FULL')
        .then((qs) => setQuotes(new Map(qs.map((q) => [quoteKey(q.exchange, q.symboltoken), q]))))
        .catch(() => undefined)
    void load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [tokens])

  if (broker?.status !== 'connected') return null
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {INDICES.map((idx) => {
        const tok = tokens?.[idx.label]
        const q = tok ? quotes.get(quoteKey(tok.exchange, tok.token)) : undefined
        const change = q?.ltp != null && q?.close ? q.ltp - q.close : null
        const changePct = change != null && q?.close ? (change / q.close) * 100 : null
        return (
          <span key={idx.label} className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-3.5 py-2 shadow-sm">
            <span className="text-xs font-bold text-gray-500">{idx.label}</span>
            {q?.ltp ? (
              <>
                <span className="font-display text-sm font-bold tabular-nums text-gray-900">{q.ltp.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                {change != null && changePct != null && (
                  <span className={`flex items-center gap-0.5 text-xs font-semibold ${change >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                    {pct(Math.abs(changePct))}
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs text-gray-300">{tokens === null ? '…' : '—'}</span>
            )}
          </span>
        )
      })}
    </div>
  )
}

/* ══════════════════════ risk widget ══════════════════════ */

function RiskWidget({ settings, counter }: { settings: RiskSettings | null; counter: RiskCounter | null }) {
  const loss = settings?.max_daily_loss ?? null
  const realizedLive = counter?.realized_pnl ?? 0
  const lossUsedPct = loss != null && realizedLive < 0 ? Math.min(100, (Math.abs(realizedLive) / loss) * 100) : 0
  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Risk guardian</h3>
        {settings?.kill_switch_active ? <Badge tone="red">Kill switch ON</Badge> : <Badge tone="green">Armed</Badge>}
      </div>
      {counter?.is_blocked && (
        <Alert tone="red" title="Trading blocked today">
          {counter.blocked_reason}{' '}
          <button className="font-semibold underline" onClick={() => void riskApi.unblock().then(() => window.location.reload())}>
            Override
          </button>
        </Alert>
      )}
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-gray-500">Daily loss used (live)</span>
          <span className={`font-semibold ${realizedLive < 0 ? 'text-red-500' : 'text-gray-400'}`}>
            {inr(Math.min(0, realizedLive))} / {loss != null ? inr(loss) : 'not set'}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full rounded-full transition-all ${lossUsedPct > 80 ? 'bg-red-500' : lossUsedPct > 50 ? 'bg-amber-400' : 'bg-emerald-400'}`}
            style={{ width: `${loss != null ? Math.max(lossUsedPct, realizedLive < 0 ? 2 : 0) : 0}%` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-gray-50 p-2">
          <p className="text-gray-400">Trades today (live)</p>
          <p className="font-display text-sm font-bold text-gray-900">
            {counter?.trades_count ?? 0} / {settings?.max_trades_per_day ?? '∞'}
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 p-2">
          <p className="text-gray-400">Open-pos cap</p>
          <p className="font-display text-sm font-bold text-gray-900">{settings?.max_open_positions ?? '∞'}</p>
        </div>
      </div>
      {loss == null && (
        <p className="text-xs text-amber-600">
          Set account risk limits before going live — live entries are blocked until max daily loss is configured (§3.7).
        </p>
      )}
    </Card>
  )
}

/* ══════════════════════ strategy cards ══════════════════════ */

function StrategyCards({ strategies, onToggle }: { strategies: StrategyListItem[]; onToggle: (s: StrategyListItem) => void }) {
  if (strategies.length === 0) return null
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-gray-900">Strategy performance</h3>
        <Link to="/strategies" className="text-xs font-semibold text-brand-600 hover:underline">
          Manage all →
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {strategies.slice(0, 6).map((s) => (
          <div key={s.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">{s.name}</p>
                <p className="text-xs text-gray-400">
                  {s.instrument} · {s.timeframe}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {s.is_active ? <Badge tone={s.mode === 'live' ? 'green' : 'blue'}>{s.mode === 'live' ? 'Live' : 'Paper'}</Badge> : <Badge tone="gray">Paused</Badge>}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Today</p>
                <p className={`font-display text-sm font-bold tabular-nums ${pnlTone(s.perf.today_pnl)}`}>{inr(s.perf.today_pnl)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">All-time</p>
                <p className={`font-display text-sm font-bold tabular-nums ${pnlTone(s.perf.total_pnl)}`}>{inr(s.perf.total_pnl)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Win rate</p>
                <p className="font-display text-sm font-bold tabular-nums text-gray-700">{pct(s.perf.win_rate, 0)}</p>
              </div>
            </div>
            <button
              onClick={() => onToggle(s)}
              className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                s.is_active ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              {s.is_active ? (
                <>
                  <Pause size={12} /> Pause
                </>
              ) : (
                <>
                  <Play size={12} /> Resume
                </>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ══════════════════════ positions panel ══════════════════════ */

function PositionsPanel({
  summary,
  quotes,
  brokerBook,
  onRefreshBroker,
  refreshingBroker,
}: {
  summary: { open: PositionRowView[] } | null
  quotes: Map<string, QuoteView>
  brokerBook: BrokerBookView | null
  onRefreshBroker: () => void
  refreshingBroker: boolean
}) {
  const [tab, setTab] = useState<'engine' | 'broker'>('engine')
  const tabs = [
    { key: 'engine' as const, label: `Engine positions (${summary?.open.length ?? 0})` },
    { key: 'broker' as const, label: 'Broker book' },
  ]
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === t.key ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'broker' && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            {brokerBook && <span>synced {fmtTimeIST(brokerBook.syncedAt)}</span>}
            <Button variant="secondary" size="sm" onClick={onRefreshBroker} loading={refreshingBroker}>
              <RefreshCw size={13} /> Refresh
            </Button>
          </div>
        )}
      </div>

      {tab === 'engine' ? (
        summary === null ? (
          <p className="py-8 text-center text-sm text-gray-400">Loading…</p>
        ) : summary.open.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">No open positions — the engine is flat.</p>
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-gray-400">
                  <th>Symbol</th>
                  <th>Side</th>
                  <th className="!text-right">Qty</th>
                  <th className="!text-right">Entry ₹</th>
                  <th className="!text-right">LTP ₹</th>
                  <th className="!text-right">Unrealized</th>
                  <th className="!text-right">SL / Target</th>
                  <th>Mode</th>
                  <th>Since</th>
                </tr>
              </thead>
              <tbody>
                {summary.open.map((p) => {
                  const q = quotes.get(quoteKey(p.exchange, p.symbol_token))
                  const ltp = q?.ltp ?? null
                  const upnl = ltp != null ? (p.side === 'LONG' ? ltp - Number(p.average_entry_price) : Number(p.average_entry_price) - ltp) * p.quantity : null
                  const rs = (p.runtime_state ?? {}) as { stopLoss?: number; target?: number }
                  return (
                    <tr key={p.id} className="[&>td]:border-b [&>td]:border-gray-50 [&>td]:px-3 [&>td]:py-2.5 hover:bg-gray-50/60">
                      <td className="font-semibold text-gray-900">{p.symbol}</td>
                      <td>
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${p.side === 'LONG' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                          {p.side}
                        </span>
                      </td>
                      <td className="text-right tabular-nums">{p.quantity}</td>
                      <td className="text-right tabular-nums">{Number(p.average_entry_price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                      <td className="text-right tabular-nums text-gray-500">{ltp != null ? ltp.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}</td>
                      <td className={`text-right font-semibold tabular-nums ${upnl == null ? 'text-gray-300' : pnlTone(upnl)}`}>{upnl == null ? '—' : inr(upnl)}</td>
                      <td className="text-right text-xs tabular-nums text-gray-500">
                        {rs.stopLoss != null ? rs.stopLoss.toFixed(2) : '—'} / {rs.target != null ? rs.target.toFixed(2) : '—'}
                      </td>
                      <td>
                        <Badge tone={p.mode === 'live' ? 'green' : 'blue'}>{p.mode}</Badge>
                      </td>
                      <td className="whitespace-nowrap text-xs text-gray-400">{fmtTimeIST(p.opened_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : brokerBook === null ? (
        <div className="py-8 text-center">
          <p className="text-sm text-gray-400">Broker book not loaded — hit Refresh to sync from Angel One (positions, holdings, funds).</p>
        </div>
      ) : (
        <div className="space-y-4">
          {brokerBook.funds && (
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-gray-50 p-2.5">
                <p className="text-gray-400">Available margin</p>
                <p className="font-display text-sm font-bold text-gray-900">{inr(brokerBook.funds.availableMargin)}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2.5">
                <p className="text-gray-400">Used margin</p>
                <p className="font-display text-sm font-bold text-gray-900">{inr(brokerBook.funds.usedMargin)}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2.5">
                <p className="text-gray-400">Available cash</p>
                <p className="font-display text-sm font-bold text-gray-900">{inr(brokerBook.funds.availableCash)}</p>
              </div>
            </div>
          )}
          <BrokerBookTable title={`Positions (${brokerBook.positions.length})`} rows={brokerBook.positions} kind="positions" />
          <BrokerBookTable title={`Holdings (${brokerBook.holdings.length})`} rows={brokerBook.holdings} kind="holdings" />
        </div>
      )}
    </Card>
  )
}

function BrokerBookTable({
  title,
  rows,
  kind,
}: {
  title: string
  rows: { tradingsymbol: string; netQuantity?: number; quantity?: number; averagePrice: number; lastTradedPrice: number; pnl: number; producttype?: string }[]
  kind: 'positions' | 'holdings'
}) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h4>
      {rows.length === 0 ? (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-400">None.</p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="[&>th]:px-3 [&>th]:py-1.5 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-semibold [&>th]:text-gray-400">
                <th>Symbol</th>
                {kind === 'positions' && <th>Product</th>}
                <th className="!text-right">Qty</th>
                <th className="!text-right">Avg ₹</th>
                <th className="!text-right">LTP ₹</th>
                <th className="!text-right">P&L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.tradingsymbol}-${r.producttype ?? ''}`} className="[&>td]:px-3 [&>td]:py-2 [&>td]:text-gray-700">
                  <td className="font-semibold text-gray-900">{r.tradingsymbol}</td>
                  {kind === 'positions' && <td className="text-xs text-gray-400">{r.producttype}</td>}
                  <td className="text-right tabular-nums">{r.netQuantity ?? r.quantity}</td>
                  <td className="text-right tabular-nums">{r.averagePrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td className="text-right tabular-nums">{r.lastTradedPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td className={`text-right font-semibold tabular-nums ${pnlTone(r.pnl)}`}>{inr(r.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════ activity (orders / trades) ══════════════════════ */

function ActivityPanel({
  orders,
  trades,
  strategyNames,
}: {
  orders: OrderRowView[] | null
  trades: TradeLogRowView[] | null
  strategyNames: Map<string, string>
}) {
  const [tab, setTab] = useState<'orders' | 'trades'>('orders')
  const [modeFilter, setModeFilter] = useState<'all' | 'paper' | 'live'>('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [strategyFilter, setStrategyFilter] = useState('all')
  const [search, setSearch] = useState('')

  const filteredOrders = useMemo(() => {
    if (!orders) return null
    const q = search.trim().toLowerCase()
    return orders.filter(
      (o) =>
        (modeFilter === 'all' || o.mode === modeFilter) &&
        (statusFilter === 'all' || o.status === statusFilter) &&
        (strategyFilter === 'all' || o.strategy_id === strategyFilter) &&
        (!q || o.symbol.toLowerCase().includes(q)),
    )
  }, [orders, modeFilter, statusFilter, strategyFilter, search])

  const filteredTrades = useMemo(() => {
    if (!trades) return null
    const q = search.trim().toLowerCase()
    return trades.filter(
      (t) =>
        (modeFilter === 'all' || t.mode === modeFilter) &&
        (strategyFilter === 'all' || t.strategy_id === strategyFilter) &&
        (statusFilter === 'all' || (statusFilter === 'win' ? t.pnl > 0 : statusFilter === 'loss' ? t.pnl <= 0 : true)) &&
        (!q || t.symbol.toLowerCase().includes(q)),
    )
  }, [trades, modeFilter, statusFilter, strategyFilter, search])

  const selectCls = 'rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-1.5 text-xs font-medium text-gray-600 focus:border-brand-400 focus:outline-none'

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {[
            { key: 'orders' as const, label: `Orders (${orders?.length ?? 0})` },
            { key: 'trades' as const, label: `Trade log (${trades?.length ?? 0})` },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key)
                setStatusFilter('all')
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === t.key ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter symbol…"
            className="w-32 rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-1.5 text-xs focus:border-brand-400 focus:outline-none"
          />
          <select className={selectCls} value={modeFilter} onChange={(e) => setModeFilter(e.target.value as typeof modeFilter)}>
            <option value="all">All modes</option>
            <option value="paper">Paper</option>
            <option value="live">Live</option>
          </select>
          <select className={selectCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {tab === 'orders' ? (
              <>
                <option value="all">All statuses</option>
                {['pending', 'open', 'complete', 'cancelled', 'rejected', 'blocked'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </>
            ) : (
              <>
                <option value="all">All outcomes</option>
                <option value="win">Winners</option>
                <option value="loss">Losers</option>
              </>
            )}
          </select>
          <select className={selectCls} value={strategyFilter} onChange={(e) => setStrategyFilter(e.target.value)}>
            <option value="all">All strategies</option>
            {[...strategyNames].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {tab === 'orders' ? (
        filteredOrders === null ? (
          <p className="py-8 text-center text-sm text-gray-400">Loading…</p>
        ) : filteredOrders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">No orders match.</p>
        ) : (
          <div className="-mx-2 max-h-[420px] overflow-auto">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 bg-white shadow-[0_1px_0_#f1f5f9]">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-gray-400">
                  <th>Time (IST)</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Type</th>
                  <th className="!text-right">Qty</th>
                  <th className="!text-right">Price</th>
                  <th className="!text-right">Avg fill</th>
                  <th>Status</th>
                  <th>Purpose</th>
                  <th>Mode</th>
                  <th>Strategy / reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((o) => (
                  <tr key={o.id} className="[&>td]:border-b [&>td]:border-gray-50 [&>td]:px-3 [&>td]:py-2.5 hover:bg-gray-50/60">
                    <td className="whitespace-nowrap text-xs text-gray-500">{fmtTimeIST(o.placed_at)}</td>
                    <td className="font-semibold text-gray-900">{o.symbol}</td>
                    <td>
                      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${o.transaction_type === 'BUY' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                        {o.transaction_type}
                      </span>
                    </td>
                    <td className="text-xs text-gray-500">{o.order_type}</td>
                    <td className="text-right tabular-nums">
                      {o.filled_quantity > 0 ? `${o.filled_quantity}/` : ''}
                      {o.quantity}
                    </td>
                    <td className="text-right tabular-nums text-gray-500">{o.price != null ? Number(o.price).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : 'MKT'}</td>
                    <td className="text-right tabular-nums">{o.average_price != null ? Number(o.average_price).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}</td>
                    <td>
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="text-xs text-gray-400">{o.purpose}</td>
                    <td>
                      <Badge tone={o.mode === 'live' ? 'green' : 'blue'}>{o.mode}</Badge>
                    </td>
                    <td className="max-w-52 truncate text-xs text-gray-400" title={o.rejection_reason ?? o.broker_order_id ?? ''}>
                      {o.rejection_reason ?? (o.strategy_id ? (strategyNames.get(o.strategy_id) ?? '—') : (o.broker_order_id ?? '—'))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : filteredTrades === null ? (
        <p className="py-8 text-center text-sm text-gray-400">Loading…</p>
      ) : filteredTrades.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">No trades match.</p>
      ) : (
        <div className="-mx-2 max-h-[420px] overflow-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 bg-white shadow-[0_1px_0_#f1f5f9]">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-gray-400">
                <th>Exit (IST)</th>
                <th>Symbol</th>
                <th>Side</th>
                <th className="!text-right">Qty</th>
                <th className="!text-right">Entry ₹</th>
                <th className="!text-right">Exit ₹</th>
                <th className="!text-right">P&L</th>
                <th>Mode</th>
                <th>Strategy</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map((t) => (
                <tr key={t.id} className="[&>td]:border-b [&>td]:border-gray-50 [&>td]:px-3 [&>td]:py-2.5 hover:bg-gray-50/60">
                  <td className="whitespace-nowrap text-xs text-gray-500">{fmtTimeIST(t.exit_time)}</td>
                  <td className="font-semibold text-gray-900">{t.symbol}</td>
                  <td>
                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${t.side === 'LONG' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                      {t.side}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">{t.quantity}</td>
                  <td className="text-right tabular-nums">{Number(t.entry_price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td className="text-right tabular-nums">{Number(t.exit_price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td className={`text-right font-semibold tabular-nums ${pnlTone(Number(t.pnl))}`}>{inr(Number(t.pnl))}</td>
                  <td>
                    <Badge tone={t.mode === 'live' ? 'green' : 'blue'}>{t.mode}</Badge>
                  </td>
                  <td className="max-w-40 truncate text-xs text-gray-400">{t.strategy_id ? (strategyNames.get(t.strategy_id) ?? '—') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ══════════════════════ page ══════════════════════ */

export default function DashboardPage() {
  const [broker, setBroker] = useState<BrokerStatusView | null>(null)
  const [brokerMissing, setBrokerMissing] = useState(false)
  const [strategies, setStrategies] = useState<StrategyListItem[] | null>(null)
  const [summary, setSummary] = useState<{ open: PositionRowView[]; closedToday: PositionRowView[] } | null>(null)
  const [realizedToday, setRealizedToday] = useState<{ paper: number; live: number }>({ paper: 0, live: 0 })
  const [orders, setOrders] = useState<OrderRowView[] | null>(null)
  const [trades, setTrades] = useState<TradeLogRowView[] | null>(null)
  const [risk, setRisk] = useState<{ settings: RiskSettings | null; counter: RiskCounter | null }>({ settings: null, counter: null })
  const [liveStatus, setLiveStatus] = useState<LiveStatusView | null>(null)
  const [quotes, setQuotes] = useState<Map<string, QuoteView>>(new Map())
  const [brokerBook, setBrokerBook] = useState<BrokerBookView | null>(null)
  const [refreshingBroker, setRefreshingBroker] = useState(false)
  const [freshTick, setFreshTick] = useState(0)
  const [toggleCandidate, setToggleCandidate] = useState<StrategyListItem | null>(null)

  const loadCore = useCallback(async () => {
    try {
      const [s, st, o, t, rk] = await Promise.all([
        dashboardApi.summary(),
        strategyApi.list(),
        dashboardApi.orders(),
        dashboardApi.trades(),
        appMeta.risk(),
      ])
      setSummary(s.positions)
      setRealizedToday(s.realizedToday)
      setStrategies(st)
      setOrders(o)
      setTrades(t)
      setRisk({ settings: rk.settings, counter: rk.today })
    } catch {
      /* transient — realtime + next interval retries */
    }
  }, [])

  useEffect(() => {
    brokerApi
      .status()
      .then((s) => {
        setBroker(s)
        setBrokerMissing(s.status !== 'connected')
      })
      .catch(() => setBrokerMissing(false))
    void loadCore()
    // Engine status: worker_heartbeats row — realtime-pushed (published in
    // migration 00003); the 15s tick just recomputes freshness ("online = beat
    // younger than 45s").
    dashboardApi.liveStatus().then(setLiveStatus).catch(() => undefined)
    const channel = supabase
      .channel('engine-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'worker_heartbeats' }, (payload) => {
        const row = payload.new as { worker?: string; state?: LiveStatusView['state']; updated_at?: string }
        if (row.worker !== 'live-engine') return
        setLiveStatus({ online: true, heartbeatAgeSec: 0, heartbeatAt: row.updated_at ?? null, state: row.state ?? null })
      })
      .subscribe()
    const freshness = setInterval(() => setFreshTick((n) => n + 1), 15_000)
    return () => {
      clearInterval(freshness)
      void supabase.removeChannel(channel)
    }
  }, [loadCore])

  // Spec §3.8: engine tables arrive via Supabase Realtime — refresh read models.
  useRealtimeTables(['orders', 'trade_logs', 'positions'], () => void loadCore())

  // Quotes for open engine positions (unrealized P&L) — 15s snapshot cadence.
  const openTokens = useMemo(() => {
    const items = (summary?.open ?? []).map((p) => ({ exchange: p.exchange, token: p.symbol_token }))
    const seen = new Set<string>()
    return items.filter((i) => {
      const k = quoteKey(i.exchange, i.token)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }, [summary?.open])

  useEffect(() => {
    if (openTokens.length === 0 || broker?.status !== 'connected') return
    const load = () =>
      dashboardApi
        .quotes(openTokens)
        .then((qs) => setQuotes(new Map(qs.map((q) => [quoteKey(q.exchange, q.symboltoken), q]))))
        .catch(() => undefined)
    void load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [openTokens, broker?.status])

  const refreshBrokerBook = useCallback((force: boolean) => {
    setRefreshingBroker(true)
    void dashboardApi
      .brokerBook(force)
      .then(setBrokerBook)
      .catch(() => setBrokerBook(null))
      .finally(() => setRefreshingBroker(false))
  }, [])

  const toggleStrategy = async (s: StrategyListItem) => {
    setToggleCandidate(null)
    try {
      await strategyApi.toggle(s.id, !s.is_active)
      setStrategies(await strategyApi.list())
    } catch {
      /* surfaced on the strategies page; dashboard stays read-mostly */
    }
  }

  // ── P&L math ──
  const unrealized = useMemo(() => {
    if (!summary) return null
    let total = 0
    let pricedAll = true
    for (const p of summary.open) {
      const q = quotes.get(quoteKey(p.exchange, p.symbol_token))
      if (!q) {
        pricedAll = false
        continue
      }
      total += (p.side === 'LONG' ? q.ltp - Number(p.average_entry_price) : Number(p.average_entry_price) - q.ltp) * p.quantity
    }
    return { value: total, complete: pricedAll }
  }, [summary, quotes])

  const allTimeRealized = useMemo(() => (strategies ?? []).reduce((a, s) => a + (s.perf?.total_pnl ?? 0), 0), [strategies])
  const dayRealizedTotal = realizedToday.paper + realizedToday.live
  const strategyNames = useMemo(() => new Map((strategies ?? []).map((s) => [s.id, s.name])), [strategies])
  const engineFeed = liveStatus?.state?.feeds ? Object.values(liveStatus.state.feeds)[0] : undefined
  void freshTick // re-render driver for heartbeat freshness
  const engineOnline = liveStatus?.heartbeatAt != null && Date.now() - new Date(liveStatus.heartbeatAt).getTime() < 45_000

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* header row: market + engine health */}
      <div className="flex flex-wrap items-center gap-2.5">
        <MarketStrip broker={broker} />
        <span
          className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-3.5 py-2 shadow-sm"
          title={liveStatus?.state ? `uptime ${Math.round((liveStatus.state.uptimeSec ?? 0) / 60)}m · ${liveStatus.state.runtimes?.length ?? 0} runtimes` : ''}
        >
          <Server size={14} className="text-gray-400" />
          <StatusDot online={liveStatus?.heartbeatAt ? engineOnline : null} />
          <span className="text-xs font-semibold text-gray-600">Engine {liveStatus?.heartbeatAt ? (engineOnline ? 'online' : 'offline') : 'unknown'}</span>
          {engineFeed?.lastTickAgeSec != null && <span className="text-[10px] text-gray-400">tick {engineFeed.lastTickAgeSec}s ago</span>}
        </span>
        {broker && (
          <Link to="/broker" className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-3.5 py-2 shadow-sm hover:border-brand-200">
            <StatusDot online={broker.status === 'connected' ? true : broker.status === 'token_expired' ? null : false} />
            <span className="text-xs font-semibold text-gray-600">
              Broker {broker.status === 'connected' ? broker.clientCode : broker.status.replace(/_/g, ' ')}
            </span>
          </Link>
        )}
      </div>

      {brokerMissing && (
        <div className="rounded-2xl bg-gradient-to-r from-brand-600 to-brand-500 p-7 text-white shadow-sm">
          <h2 className="font-display text-xl font-semibold">Connect to your broker</h2>
          <p className="mt-1 max-w-md text-sm text-white/85">Deploy, manage &amp; track your strategies — all from one Angel One account.</p>
          <Link
            to="/broker"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-brand-50"
          >
            <Plus size={16} /> Add Broker
          </Link>
        </div>
      )}

      {/* P&L hero */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Realized today</p>
          <p className={`mt-1 font-display text-2xl font-bold tabular-nums ${pnlTone(dayRealizedTotal)}`}>{inr(dayRealizedTotal)}</p>
          <p className="mt-0.5 text-xs text-gray-400">
            <span className={pnlTone(realizedToday.live)}>live {inr(realizedToday.live)}</span> · <span className={pnlTone(realizedToday.paper)}>paper {inr(realizedToday.paper)}</span>
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Unrealized (open positions)</p>
          <p className={`mt-1 font-display text-2xl font-bold tabular-nums ${unrealized ? pnlTone(unrealized.value) : 'text-gray-400'}`}>
            {summary?.open.length ? inr(unrealized?.value ?? 0) + (unrealized && !unrealized.complete ? '*' : '') : inr(0)}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">{summary?.open.length ?? 0} open · marks refresh 15s{unrealized && !unrealized.complete ? ' · *some unpriced' : ''}</p>
        </Card>
        <Card className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">All-time realized</p>
          <p className={`mt-1 font-display text-2xl font-bold tabular-nums ${pnlTone(allTimeRealized)}`}>{inr(allTimeRealized)}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
            <TrendingUp size={12} />
            day total {inr(dayRealizedTotal + (unrealized?.value ?? 0))} · {summary?.closedToday.length ?? 0} closed today
          </p>
        </Card>
        <RiskWidget settings={risk.settings} counter={risk.counter} />
      </div>

      {/* strategy performance */}
      {strategies && strategies.length > 0 ? (
        <StrategyCards strategies={strategies} onToggle={setToggleCandidate} />
      ) : strategies !== null && (
        <Card className="text-center">
          <Activity className="mx-auto text-gray-300" size={28} />
          <p className="mt-2 text-sm text-gray-500">No strategies yet — build your first one and watch it trade here.</p>
          <Link to="/strategies/new" className="mt-3 inline-block">
            <Button size="sm">
              <Plus size={14} /> New strategy
            </Button>
          </Link>
        </Card>
      )}

      <PositionsPanel
        summary={summary}
        quotes={quotes}
        brokerBook={brokerBook}
        onRefreshBroker={() => refreshBrokerBook(true)}
        refreshingBroker={refreshingBroker}
      />

      <ActivityPanel orders={orders} trades={trades} strategyNames={strategyNames} />

      {/* pause/resume confirm (mirrors the strategies page semantics) */}
      <Modal open={toggleCandidate != null} onClose={() => setToggleCandidate(null)} title={toggleCandidate?.is_active ? 'Pause strategy?' : 'Resume strategy?'}>
        {toggleCandidate && (
          <>
            <p className="text-sm text-gray-600">
              {toggleCandidate.is_active ? (
                <>
                  <strong>{toggleCandidate.name}</strong> stops evaluating within the worker's 5-second reconcile loop.{' '}
                  <span className="text-amber-700">
                    Its SL / target / trailing levels stay saved on the open position and resume when you re-activate — the position is NOT
                    squared off automatically.
                  </span>
                </>
              ) : (
                <>
                  <strong>{toggleCandidate.name}</strong> warms up its indicators from recent candles and starts evaluating candle closes.
                  Entries fire only on candles completed entirely after activation (never on stale candles); an already-open position resumes
                  exit management immediately.
                </>
              )}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setToggleCandidate(null)}>
                Cancel
              </Button>
              <Button variant={toggleCandidate.is_active ? 'secondary' : 'primary'} onClick={() => void toggleStrategy(toggleCandidate)}>
                {toggleCandidate.is_active ? 'Pause' : 'Resume'}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
