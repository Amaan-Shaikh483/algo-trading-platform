import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Download, FlaskConical, Play, RefreshCw, Trash2 } from 'lucide-react'
import { Alert, Badge, Button, Card } from '../components/ui'
import { ApiError } from '../lib/api'
import { backtestApi, isActiveRun } from '../lib/backtestApi'
import type { BacktestDayRow, BacktestRunDetail, BacktestRunSummary, BacktestTrade, ExitReason } from '../lib/backtestApi'
import { strategyApi } from '../lib/strategyApi'
import type { StrategyListItem } from '../lib/strategyApi'

/* ───────────────────────── helpers ───────────────────────── */

const inr = (v: number) => `${v < 0 ? '−' : ''}₹${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const pct = (v: number) => `${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`
const pnlTone = (v: number) => (v > 0 ? 'text-emerald-600' : v < 0 ? 'text-red-500' : 'text-gray-400')

const IST = 'Asia/Kolkata'
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' })
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

const EXIT_REASON_LABELS: Record<ExitReason, string> = {
  stop_loss: 'Stop loss',
  trailing_stop: 'Trailing SL',
  target: 'Target',
  time_squareoff: 'Time square-off',
  max_holding: 'Max holding',
  end_of_data: 'End of data',
}

/* ───────────────────────── run form ───────────────────────── */

type RangeKey = '1M' | '3M' | '6M' | '1Y' | 'custom'

function toInputDate(d: Date): string {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}
function rangeFor(key: RangeKey): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to)
  if (key === '1M') from.setMonth(from.getMonth() - 1)
  else if (key === '3M') from.setMonth(from.getMonth() - 3)
  else if (key === '6M') from.setMonth(from.getMonth() - 6)
  else from.setFullYear(from.getFullYear() - 1)
  return { from: toInputDate(from), to: toInputDate(to) }
}

interface FormState {
  strategyId: string
  rangeKey: RangeKey
  from: string
  to: string
  capital: string
  brokerageType: 'flat' | 'percent'
  brokerageValue: string
  slippage: string
}

function RunForm({
  strategies,
  submitting,
  onSubmit,
}: {
  strategies: StrategyListItem[] | null
  submitting: boolean
  onSubmit: (f: FormState) => void
}) {
  const [form, setForm] = useState<FormState>({
    strategyId: '',
    rangeKey: '3M',
    ...rangeFor('3M'),
    capital: '100000',
    brokerageType: 'flat',
    brokerageValue: '20',
    slippage: '0.05',
  })
  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }))

  const noStrategies = strategies !== null && strategies.length === 0
  const disabled = submitting || !form.strategyId || !form.from || !form.to

  return (
    <Card className="self-start">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <FlaskConical size={18} />
        </span>
        <div>
          <h2 className="font-display text-base font-semibold text-gray-900">New backtest</h2>
          <p className="text-xs text-gray-400">Bar-by-bar replay on historical candles</p>
        </div>
      </div>

      {noStrategies ? (
        <Alert tone="yellow" title="No strategies yet">
          Create one in the <Link to="/strategies/new" className="font-semibold underline">strategy builder</Link> first.
        </Alert>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">Strategy</span>
            <select
              className="w-full rounded-lg border border-gray-200 bg-gray-50/60 px-3.5 py-2.5 text-sm focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
              value={form.strategyId}
              onChange={(e) => patch({ strategyId: e.target.value })}
            >
              <option value="">Select a strategy…</option>
              {(strategies ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.instrument} {s.timeframe}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-gray-700">Date range</span>
            <div className="mb-2 flex gap-1.5">
              {(['1M', '3M', '6M', '1Y', 'custom'] as RangeKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => patch(k === 'custom' ? { rangeKey: k } : { rangeKey: k, ...rangeFor(k) })}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    form.rangeKey === k ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {k === 'custom' ? 'Custom' : k}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={form.from}
                max={form.to}
                disabled={form.rangeKey !== 'custom'}
                onChange={(e) => patch({ from: e.target.value })}
                className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2 text-sm focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:opacity-60"
              />
              <input
                type="date"
                value={form.to}
                min={form.from}
                max={toInputDate(new Date())}
                disabled={form.rangeKey !== 'custom'}
                onChange={(e) => patch({ to: e.target.value })}
                className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2 text-sm focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:opacity-60"
              />
            </div>
            <p className="mt-1 text-xs text-gray-400">IST wall-clock · range capped at 2 years</p>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">Initial capital</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">₹</span>
              <input
                type="number"
                min={1000}
                step={1000}
                value={form.capital}
                onChange={(e) => patch({ capital: e.target.value })}
                className="w-full rounded-lg border border-gray-200 bg-gray-50/60 py-2.5 pl-8 pr-3.5 text-sm focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </div>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Brokerage</span>
              <div className="flex overflow-hidden rounded-lg border border-gray-200">
                {(['flat', 'percent'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => patch({ brokerageType: k })}
                    className={`flex-1 px-2 py-2.5 text-xs font-semibold ${form.brokerageType === k ? 'bg-brand-600 text-white' : 'bg-gray-50/60 text-gray-500 hover:bg-gray-100'}`}
                  >
                    {k === 'flat' ? 'Flat ₹/side' : '% /side'}
                  </button>
                ))}
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">{form.brokerageType === 'flat' ? '₹ per side' : '% per side'}</span>
              <input
                type="number"
                min={0}
                step={form.brokerageType === 'flat' ? 1 : 0.01}
                value={form.brokerageValue}
                onChange={(e) => patch({ brokerageValue: e.target.value })}
                className="w-full rounded-lg border border-gray-200 bg-gray-50/60 px-3.5 py-2.5 text-sm focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">Slippage</span>
            <div className="relative">
              <input
                type="number"
                min={0}
                max={5}
                step={0.01}
                value={form.slippage}
                onChange={(e) => patch({ slippage: e.target.value })}
                className="w-full rounded-lg border border-gray-200 bg-gray-50/60 py-2.5 pl-3.5 pr-8 text-sm focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
              <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
            </div>
            <span className="mt-1 block text-xs text-gray-400">Applied adversely on every fill (0–5%)</span>
          </label>

          <Button className="w-full" disabled={disabled} loading={submitting} onClick={() => onSubmit(form)}>
            <Play size={15} /> Run backtest
          </Button>
          <p className="text-center text-[11px] leading-relaxed text-gray-400">
            Fetches historical candles from your connected broker in chunks — large ranges can take a minute.
            Fair-use limit: 25 runs/day.
          </p>
        </div>
      )}
    </Card>
  )
}

/* ───────────────────────── runs list ───────────────────────── */

function RunStatusBadge({ run }: { run: BacktestRunSummary }) {
  if (run.status === 'completed') return <Badge tone="green">Completed</Badge>
  if (run.status === 'failed') return <Badge tone="red">Failed</Badge>
  if (run.status === 'running') return <Badge tone="yellow">Running</Badge>
  return <Badge tone="blue">Queued</Badge>
}

function RunsList({
  runs,
  selectedId,
  onSelect,
  onDelete,
  onRefresh,
  refreshing,
}: {
  runs: BacktestRunSummary[] | null
  selectedId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRefresh: () => void
  refreshing: boolean
}) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-base font-semibold text-gray-900">Runs</h2>
          <p className="text-xs text-gray-400">Newest first · auto-refreshes while a run is active</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh} loading={refreshing}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {runs === null ? (
        <p className="py-10 text-center text-sm text-gray-400">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
          No backtests yet — run your first one from the form.
        </p>
      ) : (
        <ul className="divide-y divide-gray-50">
          {runs.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => onSelect(r.id)}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-gray-50 ${
                  selectedId === r.id ? 'bg-brand-50/70 hover:bg-brand-50' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-gray-900">{r.params.strategyName}</span>
                    <RunStatusBadge run={r} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-400">
                    {fmtDate(r.params.from)} → {fmtDate(r.params.to)} · capital {inr(r.params.initialCapital)} ·{' '}
                    {r.params.brokerageType === 'flat' ? `₹${r.params.brokerageValue}/side` : `${r.params.brokerageValue}%/side`} · slip{' '}
                    {r.params.slippagePercent}%
                  </p>
                  {isActiveRun(r) && (
                    <div className="mt-2 h-1.5 w-full max-w-52 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-brand-500 transition-all duration-500"
                        style={{ width: `${Math.max(4, r.progress)}%` }}
                      />
                    </div>
                  )}
                  {r.status === 'failed' && r.error && <p className="mt-1 text-xs text-red-500">{r.error}</p>}
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(r.id)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && onDelete(r.id)}
                  className="rounded-lg p-1.5 text-gray-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                  title="Delete run"
                >
                  <Trash2 size={15} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ───────────────────────── results: stat cards ───────────────────────── */

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 font-display text-xl font-bold ${tone ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

/* ───────────────────────── results: trade log ───────────────────────── */

type SortKey = 'entryTime' | 'exitTime' | 'side' | 'quantity' | 'entryPrice' | 'exitPrice' | 'grossPnl' | 'fees' | 'netPnl' | 'exitReason' | 'barsHeld'

function TradesTable({ trades, strategyName }: { trades: BacktestTrade[]; strategyName: string }) {
  const [sortKey, setSortKey] = useState<SortKey>('entryTime')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [sideFilter, setSideFilter] = useState<'all' | 'LONG' | 'SHORT'>('all')
  const [reasonFilter, setReasonFilter] = useState<'all' | ExitReason>('all')
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | 'win' | 'loss'>('all')

  const filtered = useMemo(() => {
    let list = trades
    if (sideFilter !== 'all') list = list.filter((t) => t.side === sideFilter)
    if (reasonFilter !== 'all') list = list.filter((t) => t.exitReason === reasonFilter)
    if (outcomeFilter !== 'all') list = list.filter((t) => (outcomeFilter === 'win' ? t.netPnl > 0 : t.netPnl <= 0))
    const dir = sortDir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      return (typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)) * dir
    })
  }, [trades, sideFilter, reasonFilter, outcomeFilter, sortKey, sortDir])

  const header = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <th
      onClick={() => {
        if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        else {
          setSortKey(key)
          setSortDir('asc')
        }
      }}
      className={`cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-${align} text-[11px] font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-600`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === key ? (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} className="opacity-40" />}
      </span>
    </th>
  )

  const exportCsv = () => {
    const cols = ['entry_time_ist', 'exit_time_ist', 'side', 'quantity', 'entry_price', 'exit_price', 'gross_pnl', 'fees', 'net_pnl', 'exit_reason', 'bars_held']
    const q = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`
    const rows = filtered.map((t) =>
      [fmtTime(t.entryTime), fmtTime(t.exitTime), t.side, t.quantity, t.entryPrice, t.exitPrice, t.grossPnl, t.fees, t.netPnl, EXIT_REASON_LABELS[t.exitReason], t.barsHeld]
        .map(q)
        .join(','),
    )
    const csv = [cols.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `backtest-${strategyName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const selectCls =
    'rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-1.5 text-xs font-medium text-gray-600 focus:border-brand-400 focus:outline-none'

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-display text-base font-semibold text-gray-900">Trade log</h3>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-500">
          {filtered.length} / {trades.length}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className={selectCls} value={sideFilter} onChange={(e) => setSideFilter(e.target.value as typeof sideFilter)}>
            <option value="all">All sides</option>
            <option value="LONG">Long</option>
            <option value="SHORT">Short</option>
          </select>
          <select className={selectCls} value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value as typeof reasonFilter)}>
            <option value="all">All exits</option>
            {Object.entries(EXIT_REASON_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select className={selectCls} value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value as typeof outcomeFilter)}>
            <option value="all">All outcomes</option>
            <option value="win">Winners</option>
            <option value="loss">Losers</option>
          </select>
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download size={14} /> CSV
          </Button>
        </div>
      </div>

      {trades.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
          No trades were generated in this window — entry conditions never fired.
        </p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[860px] border-separate border-spacing-0">
            <thead>
              <tr className="bg-gray-50/80">
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">#</th>
                {header('entryTime', 'Entry (IST)', 'left')}
                {header('exitTime', 'Exit (IST)', 'left')}
                {header('side', 'Side', 'left')}
                {header('quantity', 'Qty')}
                {header('entryPrice', 'Entry ₹')}
                {header('exitPrice', 'Exit ₹')}
                {header('grossPnl', 'Gross')}
                {header('fees', 'Fees')}
                {header('netPnl', 'Net P&L')}
                {header('exitReason', 'Exit reason', 'left')}
                {header('barsHeld', 'Bars')}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => (
                <tr key={`${t.entryTime}-${i}`} className="text-sm hover:bg-gray-50/60 [&>td]:border-b [&>td]:border-gray-50">
                  <td className="px-3 py-2 text-xs text-gray-400">{i + 1}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">{fmtTime(t.entryTime)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">{fmtTime(t.exitTime)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${t.side === 'LONG' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                      {t.side}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{t.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{t.entryPrice.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{t.exitPrice.toLocaleString('en-IN')}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${pnlTone(t.grossPnl)}`}>{inr(t.grossPnl)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{inr(t.fees)}</td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${pnlTone(t.netPnl)}`}>{inr(t.netPnl)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{EXIT_REASON_LABELS[t.exitReason]}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{t.barsHeld}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="py-6 text-center text-sm text-gray-400">No trades match the current filters.</p>}
        </div>
      )}
    </Card>
  )
}

/* ───────────── results: daywise analytics (AlgoRooms-parity) ───────────── */

const IST_DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: IST }) // YYYY-MM-DD
const dayKeyOf = (iso: string) => IST_DAY_FMT.format(new Date(iso))
const fmtDayKey = (d: string) =>
  new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' })

function DaywiseSummary({ rows }: { rows: BacktestDayRow[] }) {
  const win = rows.filter((r) => r.pnl > 0)
  const loss = rows.filter((r) => r.pnl < 0)
  const total = rows.reduce((a, r) => a + r.pnl, 0)
  const best = rows.reduce<BacktestDayRow | null>((a, r) => (a === null || r.pnl > a.pnl ? r : a), null)
  const worst = rows.reduce<BacktestDayRow | null>((a, r) => (a === null || r.pnl < a.pnl ? r : a), null)
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Trading days" value={`${rows.length}`} sub={`${win.length} win / ${loss.length} loss days`} />
      <StatCard label="Win-day rate" value={pct(rows.length ? (win.length / rows.length) * 100 : 0)} sub={`${win.length} of ${rows.length}`} />
      <StatCard label="Avg P&L / day" value={inr(rows.length ? total / rows.length : 0)} tone={pnlTone(total)} />
      <StatCard label="Best day" value={best ? inr(best.pnl) : '—'} sub={best ? fmtDayKey(best.date) : undefined} tone="text-emerald-600" />
      <StatCard label="Worst day" value={worst ? inr(worst.pnl) : '—'} sub={worst ? fmtDayKey(worst.date) : undefined} tone="text-red-500" />
      <StatCard label="Flat days" value={`${rows.length - win.length - loss.length}`} sub="no realized P&L" />
    </div>
  )
}

function DailyPnlChart({ rows }: { rows: BacktestDayRow[] }) {
  return (
    <Card>
      <h3 className="mb-1 font-display text-base font-semibold text-gray-900">Daily P&L</h3>
      <p className="mb-3 text-xs text-gray-400">Net realized profit/loss per day (after fees)</p>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef1f6" />
            <XAxis dataKey="date" tickFormatter={(d: string) => fmtDayKey(d).slice(0, 6)} minTickGap={32} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis
              width={74}
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `₹${Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(1)}L` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
            />
            <Tooltip
              formatter={(v) => [inr(Number(v)), 'Day P&L']}
              labelFormatter={(l) => fmtDayKey(String(l))}
              contentStyle={{ borderRadius: 12, border: '1px solid #eef1f6', fontSize: 12 }}
            />
            <Bar dataKey="pnl" isAnimationActive={false} radius={[3, 3, 0, 0]}>
              {rows.map((r) => (
                <Cell key={r.date} fill={r.pnl > 0 ? '#16a34a' : r.pnl < 0 ? '#dc2626' : '#d1d5db'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

/* daywise calendar heatmap (GitHub-contributions style, per month) */

const HEAT_POS = ['#dcfce7', '#86efac', '#4ade80', '#16a34a']
const HEAT_NEG = ['#fee2e2', '#fca5a5', '#f87171', '#dc2626']
const HEAT_ZERO = '#f3f4f6'
const HEAT_NONE = '#f8fafc'

function heatColor(pnl: number, maxAbs: number): string {
  if (pnl === 0 || maxAbs === 0) return HEAT_ZERO
  const scale = pnl > 0 ? HEAT_POS : HEAT_NEG
  return scale[Math.min(3, Math.floor((Math.abs(pnl) / maxAbs) * 4))]
}

function MonthGrid({ month, byDate, maxAbs }: { month: string; byDate: Map<string, BacktestDayRow>; maxAbs: number }) {
  const y = Number(month.slice(0, 4))
  const mo = Number(month.slice(5, 7))
  const daysInMonth = new Date(y, mo, 0).getDate()
  const firstWeekday = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7 // Mon = 0
  const weeks = Math.ceil((firstWeekday + daysInMonth) / 7)
  const monthTotal = [...byDate.values()].filter((r) => r.date.startsWith(month)).reduce((a, r) => a + r.pnl, 0)

  const cells: Array<{ key: string; row: BacktestDayRow | null; inMonth: boolean }> = []
  for (let col = 0; col < weeks; col++) {
    for (let row = 0; row < 7; row++) {
      const dayNum = col * 7 + row - firstWeekday + 1
      const inMonth = dayNum >= 1 && dayNum <= daysInMonth
      const date = inMonth ? `${month}-${String(dayNum).padStart(2, '0')}` : null
      cells.push({ key: date ?? `${month}-x${col}-${row}`, row: date ? (byDate.get(date) ?? null) : null, inMonth })
    }
  }

  return (
    <div className="flex flex-col items-center">
      <div className="flex gap-1">
        <div className="mr-0.5 grid grid-rows-7 gap-[3px] text-[8px] leading-[14px] text-gray-300">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${weeks}, 0.875rem)` }}>
          {cells.map((c) => (
            <span
              key={c.key}
              title={c.row ? `${fmtDayKey(c.row.date)} · ${inr(c.row.pnl)} · ${c.row.trades} trade${c.row.trades === 1 ? '' : 's'}` : undefined}
              className="h-3.5 w-3.5 rounded-[3px]"
              style={{ background: !c.inMonth ? 'transparent' : c.row ? heatColor(c.row.pnl, maxAbs) : HEAT_NONE }}
            />
          ))}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] font-semibold text-gray-500">
        {new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
      </p>
      <p className={`text-[11px] font-bold ${pnlTone(monthTotal)}`}>{inr(monthTotal)}</p>
    </div>
  )
}

function DaywiseHeatmap({ rows }: { rows: BacktestDayRow[] }) {
  const byDate = new Map(rows.map((r) => [r.date, r]))
  const maxAbs = rows.reduce((a, r) => Math.max(a, Math.abs(r.pnl)), 0)
  const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort()
  return (
    <Card>
      <h3 className="mb-1 font-display text-base font-semibold text-gray-900">Daywise breakdown</h3>
      <p className="mb-3 text-xs text-gray-400">One square per day · green = profit, red = loss · deeper shade = larger move</p>
      <div className="flex flex-wrap gap-6 overflow-x-auto pb-1">
        {months.map((mo) => (
          <MonthGrid key={mo} month={mo} byDate={byDate} maxAbs={maxAbs} />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-gray-400">
        <span>Loss</span>
        {[...HEAT_NEG].reverse().map((c) => (
          <span key={c} className="h-3 w-3 rounded-[3px]" style={{ background: c }} />
        ))}
        <span className="h-3 w-3 rounded-[3px]" style={{ background: HEAT_ZERO }} />
        {HEAT_POS.map((c) => (
          <span key={c} className="h-3 w-3 rounded-[3px]" style={{ background: c }} />
        ))}
        <span>Profit</span>
      </div>
    </Card>
  )
}

/* transaction details — per-day rows, expandable to that day's trades */

function DayBreakdown({ rows, trades }: { rows: BacktestDayRow[]; trades: BacktestTrade[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const tradesByDay = useMemo(() => {
    const map = new Map<string, BacktestTrade[]>()
    for (const t of trades) {
      const k = dayKeyOf(t.exitTime)
      const arr = map.get(k) ?? []
      arr.push(t)
      map.set(k, arr)
    }
    return map
  }, [trades])
  const desc = useMemo(() => [...rows].reverse(), [rows])

  return (
    <Card>
      <h3 className="mb-1 font-display text-base font-semibold text-gray-900">Transaction details</h3>
      <p className="mb-3 text-xs text-gray-400">Per-day realized P&L (newest first) · click a day to see its trades</p>
      <ul className="divide-y divide-gray-50">
        {desc.map((d) => {
          const dayTrades = tradesByDay.get(d.date) ?? []
          const expanded = open === d.date
          return (
            <li key={d.date}>
              <button onClick={() => setOpen(expanded ? null : d.date)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-gray-50/60">
                {expanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                <span className="w-32 text-sm font-medium text-gray-700">{fmtDayKey(d.date)}</span>
                <span className="w-24 text-xs text-gray-400">{d.trades} trade{d.trades === 1 ? '' : 's'}</span>
                <span className="ml-auto text-sm font-bold tabular-nums" style={{ color: d.pnl > 0 ? '#059669' : d.pnl < 0 ? '#ef4444' : '#9ca3af' }}>
                  P&L {inr(d.pnl)}
                </span>
                <span className="w-28 text-right text-xs tabular-nums text-gray-400">eq {inr(d.equity)}</span>
              </button>
              {expanded && (
                <div className="mb-2 ml-7 overflow-x-auto rounded-xl bg-gray-50/70 p-3">
                  {dayTrades.length === 0 ? (
                    <p className="py-2 text-xs text-gray-400">No trades exited this day.</p>
                  ) : (
                    <table className="w-full min-w-[640px] text-xs">
                      <thead>
                        <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                          <th className="py-1 pr-3">Entry</th>
                          <th className="py-1 pr-3">Exit</th>
                          <th className="py-1 pr-3">Side</th>
                          <th className="py-1 pr-3 text-right">Qty</th>
                          <th className="py-1 pr-3 text-right">Entry ₹</th>
                          <th className="py-1 pr-3 text-right">Exit ₹</th>
                          <th className="py-1 pr-3 text-right">Net P&L</th>
                          <th className="py-1 text-right">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dayTrades.map((t, i) => (
                          <tr key={`${t.entryTime}-${i}`} className="text-gray-600">
                            <td className="whitespace-nowrap py-1 pr-3">{fmtTime(t.entryTime)}</td>
                            <td className="whitespace-nowrap py-1 pr-3">{fmtTime(t.exitTime)}</td>
                            <td className="py-1 pr-3">
                              <span className={`rounded px-1 py-0.5 text-[10px] font-bold ${t.side === 'LONG' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                                {t.side}
                              </span>
                            </td>
                            <td className="py-1 pr-3 text-right tabular-nums">{t.quantity}</td>
                            <td className="py-1 pr-3 text-right tabular-nums">{t.entryPrice.toLocaleString('en-IN')}</td>
                            <td className="py-1 pr-3 text-right tabular-nums">{t.exitPrice.toLocaleString('en-IN')}</td>
                            <td className={`py-1 pr-3 text-right font-semibold tabular-nums ${pnlTone(t.netPnl)}`}>{inr(t.netPnl)}</td>
                            <td className="whitespace-nowrap py-1 text-right text-gray-500">{EXIT_REASON_LABELS[t.exitReason]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/* ───────────────────────── results view ───────────────────────── */

function tickDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short' })
}

function Results({ detail }: { detail: BacktestRunDetail }) {
  const r = detail.result
  if (detail.status === 'failed') {
    const brokerIssue = (detail.error ?? '').toLowerCase().includes('broker')
    return (
      <Alert tone="red" title="Backtest failed">
        {detail.error ?? 'Unknown error'}
        {brokerIssue && (
          <>
            {' '}
            <Link to="/broker" className="font-semibold underline">
              Open broker connection →
            </Link>
          </>
        )}
      </Alert>
    )
  }
  if (!r) return null
  const s = r.summary
  const pf = s.profitFactor === Infinity ? '∞' : s.profitFactor.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  // Daywise UI appears on runs created after dailyRows shipped; older runs keep the classic view.
  const dayRows = r.dailyRows ?? []

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Net P&L" value={inr(s.totalNetPnl)} sub={`${pct(s.totalReturnPct)} on ${inr(s.initialCapital)}`} tone={pnlTone(s.totalNetPnl)} />
        <StatCard label="Win rate" value={pct(s.winRate)} sub={`${s.wins}W / ${s.losses}L of ${s.totalTrades}`} />
        <StatCard label="Profit factor" value={pf} sub={`avg win ${inr(s.averageWin)} · loss ${inr(s.averageLoss)}`} tone={Number.isFinite(s.profitFactor) && s.profitFactor < 1 ? 'text-red-500' : 'text-emerald-600'} />
        <StatCard label="Max drawdown" value={inr(s.maxDrawdown)} sub={pct(s.maxDrawdownPct)} tone="text-red-500" />
        <StatCard label="Total trades" value={`${s.totalTrades}`} sub={`${s.skippedSignals} signals skipped · exposure ${pct(s.exposurePct)}`} />
        <StatCard label="Expectancy / trade" value={inr(s.expectancy)} tone={pnlTone(s.expectancy)} />
        <StatCard label="Largest win" value={inr(s.largestWin)} sub={`largest loss ${inr(s.largestLoss)}`} tone="text-emerald-600" />
        <StatCard label="Sharpe (daily, √252)" value={s.sharpeDaily.toLocaleString('en-IN', { maximumFractionDigits: 2 })} />
        <StatCard label="Fees paid" value={inr(s.totalFees)} />
        <StatCard label="Final equity" value={inr(s.finalEquity)} sub={`${s.candlesProcessed.toLocaleString('en-IN')} candles replayed`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <h3 className="mb-1 font-display text-base font-semibold text-gray-900">Equity curve</h3>
          <p className="mb-3 text-xs text-gray-400">Mark-to-market at every bar close (incl. unrealized)</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={r.equityCurve} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2c54e8" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#2c54e8" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef1f6" />
                <XAxis dataKey="t" tickFormatter={tickDate} minTickGap={48} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis
                  domain={['auto', 'auto']}
                  width={74}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `₹${v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                />
                <Tooltip
                  formatter={(v) => [inr(Number(v)), 'Equity']}
                  labelFormatter={(l) => fmtTime(String(l))}
                  contentStyle={{ borderRadius: 12, border: '1px solid #eef1f6', fontSize: 12 }}
                />
                <Area type="monotone" dataKey="equity" stroke="#2c54e8" strokeWidth={2} fill="url(#eqFill)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h3 className="mb-1 font-display text-base font-semibold text-gray-900">Drawdown</h3>
          <p className="mb-3 text-xs text-gray-400">Peak-to-trough from running equity high</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={r.drawdownCurve} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.02} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.25} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef1f6" />
                <XAxis dataKey="t" tickFormatter={tickDate} minTickGap={48} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis
                  width={74}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `₹${v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
                />
                <Tooltip
                  formatter={(v) => [inr(Number(v)), 'Drawdown']}
                  labelFormatter={(l) => fmtTime(String(l))}
                  contentStyle={{ borderRadius: 12, border: '1px solid #eef1f6', fontSize: 12 }}
                />
                <Area type="monotone" dataKey="drawdown" stroke="#ef4444" strokeWidth={1.75} fill="url(#ddFill)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {dayRows.length > 0 && (
        <>
          <DaywiseSummary rows={dayRows} />
          <DailyPnlChart rows={dayRows} />
          <DaywiseHeatmap rows={dayRows} />
          <DayBreakdown rows={dayRows} trades={r.trades} />
        </>
      )}

      <TradesTable trades={r.trades} strategyName={detail.params.strategyName} />

      <p className="text-xs leading-relaxed text-gray-400">
        Execution model: signals on closed bars, entries at the signal bar's close; SL/target/trailing fill intra-bar at the
        trigger price (gap-adjusted to the open); both SL+target in one bar assumes the stop; trailing stops ratchet at bar
        end; positions open at the final bar are closed as “end of data”. Backtests are point-in-time simulations — live
        fills, liquidity and partial cancellations can differ.
      </p>
    </div>
  )
}

/* ───────────────────────── page ───────────────────────── */

export default function BacktestPage() {
  const [strategies, setStrategies] = useState<StrategyListItem[] | null>(null)
  const [runs, setRuns] = useState<BacktestRunSummary[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<BacktestRunDetail | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const list = await backtestApi.list()
      setRuns(list)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    strategyApi.list().then(setStrategies).catch((err) => setError((err as Error).message))
    void refresh()
  }, [refresh])

  // Auto-poll while anything is queued/running; sync the open detail too.
  const anyActive = (runs?.some(isActiveRun) ?? false) || (detail ? isActiveRun(detail) : false)
  useEffect(() => {
    if (!anyActive) return
    const t = setInterval(() => {
      void backtestApi.list().then(setRuns).catch(() => undefined)
      if (selectedId) void backtestApi.get(selectedId).then(setDetail).catch(() => undefined)
    }, 2500)
    return () => clearInterval(t)
  }, [anyActive, selectedId])

  const selectRun = async (id: string) => {
    setSelectedId(id)
    try {
      setDetail(await backtestApi.get(id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const submit = async (f: {
    strategyId: string
    from: string
    to: string
    capital: string
    brokerageType: 'flat' | 'percent'
    brokerageValue: string
    slippage: string
  }) => {
    setError(null)
    setNotice(null)
    const capital = Number(f.capital)
    const brokerageValue = Number(f.brokerageValue)
    const slippage = Number(f.slippage)
    if (!Number.isFinite(capital) || capital < 1000) return setError('Initial capital must be at least ₹1,000')
    if (!Number.isFinite(brokerageValue) || brokerageValue < 0) return setError('Brokerage value must be zero or positive')
    if (!Number.isFinite(slippage) || slippage < 0 || slippage > 5) return setError('Slippage must be between 0 and 5%')
    if (new Date(f.from) >= new Date(f.to)) return setError('From date must be before To date')

    setSubmitting(true)
    try {
      const run = await backtestApi.create({
        strategyId: f.strategyId,
        from: new Date(`${f.from}T00:00:00+05:30`).toISOString(),
        to: new Date(`${f.to}T23:59:59.999+05:30`).toISOString(),
        initialCapital: capital,
        brokerageType: f.brokerageType,
        brokerageValue,
        slippagePercent: slippage,
      })
      setNotice('Backtest queued — fetching historical candles from your broker. This page refreshes automatically.')
      setSelectedId(run.id)
      setDetail(run)
      await refresh()
    } catch (err) {
      const e = err as ApiError
      setError(e.code === 'RATE_LIMITED' ? 'Daily backtest limit reached (25/day). Try again tomorrow.' : e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (id: string) => {
    setError(null)
    try {
      await backtestApi.remove(id)
      if (selectedId === id) {
        setSelectedId(null)
        setDetail(null)
      }
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const selectedSummary = runs?.find((r) => r.id === selectedId)
  const showResults = detail && detail.status === 'completed' && detail.result
  const showFailed = detail && detail.status === 'failed'
  const showRunning = detail && isActiveRun(detail)

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-gray-900">Backtesting</h1>
        <p className="mt-0.5 text-sm text-gray-400">
          Replay a strategy on historical candles with incremental indicators, realistic fills, brokerage & slippage.
        </p>
      </div>

      {error && <Alert tone="red" title="Something went wrong">{error}</Alert>}
      {notice && <Alert tone="blue">{notice}</Alert>}

      <div className="grid items-start gap-5 lg:grid-cols-[380px,1fr]">
        <RunForm strategies={strategies} submitting={submitting} onSubmit={submit} />
        <RunsList runs={runs} selectedId={selectedId} onSelect={selectRun} onDelete={remove} onRefresh={refresh} refreshing={refreshing} />
      </div>

      {showRunning && (
        <Card>
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">
                {selectedSummary?.params.strategyName ?? detail!.params.strategyName} — {detail!.status === 'queued' ? 'waiting in queue…' : 'replaying candles…'}
              </p>
              <div className="mt-2 h-2 w-full max-w-md overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${Math.max(4, detail!.progress)}%` }} />
              </div>
            </div>
            <span className="font-display text-lg font-bold text-brand-600">{detail!.progress}%</span>
          </div>
        </Card>
      )}

      {showFailed && detail && <Results detail={detail} />}
      {showResults && detail && <Results detail={detail} />}
    </div>
  )
}
