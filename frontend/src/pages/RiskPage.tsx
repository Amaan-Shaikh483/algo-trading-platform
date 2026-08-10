import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Gauge, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Alert, Badge, Button, Card, Modal, TextInput } from '../components/ui'
import BeginnerHint from '../components/BeginnerHint'
import KillSwitchButton from '../components/KillSwitchButton'
import { riskApi } from '../lib/riskApi'
import { appMeta } from '../lib/appMeta'
import type { RiskCounter, RiskSettings } from '../lib/riskApi'
import { dashboardApi } from '../lib/dashboardApi'
import type { OrderRowView } from '../lib/dashboardApi'
import { useRealtimeTables } from '../lib/realtime'
import { fmtTimeIST, inr } from '../lib/format'

/** Usage bar: current vs limit with a threshold-tinted fill. */
function UsageBar({ current, limit, invert = false }: { current: number; limit: number | null; invert?: boolean }) {
  const ratio = limit && limit > 0 ? Math.min(1, Math.abs(current) / limit) : 0
  const fill = ratio >= 1 ? 'bg-red-500' : ratio >= 0.7 ? 'bg-amber-400' : invert ? 'bg-emerald-500' : 'bg-brand-500'
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
      <div className={`h-full rounded-full transition-all ${fill}`} style={{ width: `${Math.max(2, ratio * 100)}%`, opacity: limit ? 1 : 0.25 }} />
    </div>
  )
}

const emptyForm = { max_daily_loss: '', max_trades_per_day: '', max_open_positions: '', capital_allocation_limit: '' }

export default function RiskPage() {
  const [settings, setSettings] = useState<RiskSettings | null>(null)
  const [today, setToday] = useState<RiskCounter | null>(null)
  const [tradingDate, setTradingDate] = useState<string>('')
  const [blockedOrders, setBlockedOrders] = useState<OrderRowView[]>([])
  const [openPositions, setOpenPositions] = useState<number>(0)
  const [form, setForm] = useState(emptyForm)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmUnblock, setConfirmUnblock] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(() => {
    Promise.all([
      riskApi.get(),
      dashboardApi.summary().catch(() => null),
      dashboardApi.orders(200).catch(() => [] as OrderRowView[]),
    ])
      .then(([risk, summary, orders]) => {
        setSettings(risk.settings)
        setToday(risk.today)
        setTradingDate(risk.tradingDate)
        setOpenPositions(summary?.positions.open.length ?? 0)
        setBlockedOrders(orders.filter((o) => o.status === 'blocked').slice(0, 8))
        if (!dirty) {
          setForm({
            max_daily_loss: risk.settings?.max_daily_loss?.toString() ?? '',
            max_trades_per_day: risk.settings?.max_trades_per_day?.toString() ?? '',
            max_open_positions: risk.settings?.max_open_positions?.toString() ?? '',
            capital_allocation_limit: risk.settings?.capital_allocation_limit?.toString() ?? '',
          })
        }
        setLoaded(true)
      })
      .catch((err) => setError((err as Error).message))
  }, [dirty])

  useEffect(load, [load])
  useRealtimeTables(['orders', 'positions'], load)

  const field = (key: keyof typeof emptyForm, label: string, hint: string) => (
    <TextInput
      label={label}
      hint={hint}
      type="number"
      min="0"
      step="any"
      inputMode="decimal"
      value={form[key]}
      placeholder="Not enforced"
      onChange={(e) => {
        setForm((f) => ({ ...f, [key]: e.target.value }))
        setDirty(true)
        setNotice(null)
      }}
    />
  )

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const num = (v: string) => (v.trim() === '' ? null : Number(v))
      for (const [k, v] of Object.entries(form)) {
        if (v.trim() !== '' && (!Number.isFinite(Number(v)) || Number(v) <= 0)) {
          throw new Error(`${k.replace(/_/g, ' ')} must be a positive number (or empty to not enforce)`)
        }
      }
      await riskApi.save({
        max_daily_loss: num(form.max_daily_loss),
        max_trades_per_day: num(form.max_trades_per_day),
        max_open_positions: num(form.max_open_positions),
        capital_allocation_limit: num(form.capital_allocation_limit),
      })
      appMeta.invalidateRisk()
      setDirty(false)
      setNotice('Risk limits saved — applied at the gate to every new order (paper and live).')
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const unblock = async () => {
    setBusy(true)
    setError(null)
    try {
      await riskApi.unblock()
      appMeta.invalidateRisk()
      setConfirmUnblock(false)
      setNotice('Daily-loss block lifted for today — new entries are allowed again.')
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const lossLimit = settings?.max_daily_loss ?? null
  const lossUsed = today && lossLimit ? Math.min(1, Math.max(0, -today.realized_pnl) / lossLimit) : 0
  const tradesLimit = settings?.max_trades_per_day ?? null
  const positionsLimit = settings?.max_open_positions ?? null

  const interventions = useMemo(() => blockedOrders, [blockedOrders])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-gray-900">Risk Control</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Account-level guardrails — enforced by the Risk Manager on <strong>every</strong> order, paper or live, with no bypass (§3.7)
        </p>
      </div>

      <BeginnerHint title="Why limits matter">
        The <strong>max daily loss</strong> is your circuit breaker: if realized losses reach it, all live strategies
        auto-pause for the rest of the day. Set one even if you're only paper trading — live mode can't be enabled
        without it.
      </BeginnerHint>

      {error && <Alert tone="red">{error}</Alert>}

      {/* Blocked banner + today's usage */}
      {today?.is_blocked && (
        <Alert tone="red" title="Trading is blocked for today">
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <p>{today.blocked_reason ?? 'Daily loss limit reached — auto-pause is active until the next trading day or manual override.'}</p>
            <Button variant="danger" size="sm" onClick={() => setConfirmUnblock(true)}>
              Manual override — unblock trading
            </Button>
          </div>
        </Alert>
      )}
      {settings?.kill_switch_active && (
        <Alert tone="red" title="Kill switch is ACTIVE">
          All strategies are deactivated and new entries are blocked at the gate. Use the kill switch (header, or below) to release.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Today's usage */}
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-gray-900">Today · {tradingDate || '—'}</h3>
            {today?.is_blocked ? <Badge tone="red">blocked</Badge> : <Badge tone="green">trading allowed</Badge>}
          </div>
          <div className="mt-5 space-y-5">
            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-gray-600">Daily loss</span>
                <span className={today && today.realized_pnl < 0 ? 'font-semibold text-red-500' : 'font-semibold text-emerald-600'}>
                  {today ? inr(today.realized_pnl) : '—'} <span className="font-normal text-gray-400">/ limit {lossLimit ? inr(lossLimit) : 'not set'}</span>
                </span>
              </div>
              <div className="mt-1.5">
                <UsageBar current={today ? -today.realized_pnl : 0} limit={lossLimit} invert />
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {!lossLimit
                  ? 'No max daily loss configured — required before strategies can run in LIVE mode.'
                  : lossUsed >= 1
                    ? 'Limit breached — auto-pause engaged.'
                    : `${Math.round(lossUsed * 100)}% of the limit consumed by realized losses.`}
              </p>
            </div>
            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-gray-600">Trades today</span>
                <span className="font-semibold text-gray-800">
                  {today?.trades_count ?? 0} <span className="font-normal text-gray-400">/ {tradesLimit ?? 'no limit'}</span>
                </span>
              </div>
              <div className="mt-1.5">
                <UsageBar current={today?.trades_count ?? 0} limit={tradesLimit} />
              </div>
            </div>
            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-gray-600">Open positions</span>
                <span className="font-semibold text-gray-800">
                  {openPositions} <span className="font-normal text-gray-400">/ {positionsLimit ?? 'no limit'}</span>
                </span>
              </div>
              <div className="mt-1.5">
                <UsageBar current={openPositions} limit={positionsLimit} />
              </div>
            </div>
            <p className="text-xs text-gray-400">
              Capital allocation: {settings?.capital_allocation_limit ? inr(settings.capital_allocation_limit) : 'not set'} — caps total deployed capital
              across open positions. Counters reset automatically each trading day.
            </p>
          </div>
        </Card>

        {/* Limits form */}
        <Card>
          <div className="flex items-center gap-2">
            <Gauge size={17} className="text-brand-600" />
            <h3 className="font-display text-base font-semibold text-gray-900">Account risk limits</h3>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Empty = not enforced (except max daily loss: without it, LIVE mode stays off — paper mode is unaffected).
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field('max_daily_loss', 'Max daily loss (₹)', 'Auto-pauses all live strategies when realized losses reach this.')}
            {field('max_trades_per_day', 'Max trades / day', 'Blocks new entries once hit (exits are never blocked).')}
            {field('max_open_positions', 'Max open positions', 'Caps concurrent open positions across all strategies.')}
            {field('capital_allocation_limit', 'Capital allocation limit (₹)', 'Total capital that may be deployed at once.')}
          </div>
          {notice && (
            <div className="mt-4">
              <Alert tone="green">{notice}</Alert>
            </div>
          )}
          <div className="mt-5 flex justify-end">
            <Button onClick={() => void save()} loading={busy} disabled={!dirty || !loaded}>
              Save risk limits
            </Button>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Kill switch panel */}
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert size={17} className="text-red-500" />
              <h3 className="font-display text-base font-semibold text-gray-900">Emergency kill switch</h3>
            </div>
            <KillSwitchButton />
          </div>
          <p className="mt-3 text-sm text-gray-500">
            “Stop All &amp; Square Off” — instantly deactivates every strategy, blocks new entries at the risk gate, and
            squares off all open live positions (paper positions close at market). The same button is pinned to the
            header of <strong>every screen</strong> for emergencies.
          </p>
          <p className="mt-2 text-xs text-gray-400">
            Releasing the switch re-enables new entries, but strategies stay paused until re-activated individually.
          </p>
        </Card>

        {/* Recent interventions */}
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck size={17} className="text-emerald-600" />
              <h3 className="font-display text-base font-semibold text-gray-900">Recent risk interventions</h3>
            </div>
            <Link to="/" className="text-xs font-semibold text-brand-600 hover:text-brand-700">
              View order timeline →
            </Link>
          </div>
          {interventions.length === 0 ? (
            <p className="mt-4 rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
              No blocked orders — the gate hasn’t had to intervene.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {interventions.map((o) => (
                <div key={o.id} className="flex items-start justify-between gap-3 rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">
                      {o.transaction_type} {o.quantity} × {o.symbol}
                      <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${o.mode === 'live' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                        {o.mode}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">{o.rejection_reason ?? 'Blocked by risk manager'}</p>
                  </div>
                  <span className="shrink-0 text-xs text-gray-400">{fmtTimeIST(o.placed_at)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Unblock confirm */}
      <Modal open={confirmUnblock} onClose={() => !busy && setConfirmUnblock(false)} title="Manual override">
        <div className="space-y-4">
          <Alert tone="yellow" title="Lift today’s trading block?">
            The daily-loss auto-pause protects you from further losses today. Unblocking re-enables new entries
            immediately — the loss limit counter still applies (breaching it again re-engages the block).
          </Alert>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirmUnblock(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void unblock()} loading={busy}>
              Unblock trading for today
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
