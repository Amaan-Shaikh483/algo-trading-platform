import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { Alert, Badge, Button, Card, Modal } from '../components/ui'
import { strategyApi } from '../lib/strategyApi'
import type { StrategyListItem } from '../lib/strategyApi'
import { appMeta } from '../lib/appMeta'
import type { RiskCounter, RiskSettings } from '../lib/riskApi'
import { summarizeRules } from '@algo/rule-schema'

function pnlTone(v: number) {
  return v > 0 ? 'text-emerald-600' : v < 0 ? 'text-red-500' : 'text-gray-400'
}
const inr = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

function StatusBadge({ s }: { s: StrategyListItem }) {
  if (!s.is_active) return <Badge tone="gray">Draft</Badge>
  return s.mode === 'live' ? <Badge tone="green">Live</Badge> : <Badge tone="blue">Paper</Badge>
}

function Toggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-gray-300'}`}
      title={on ? 'Active — click to pause' : 'Inactive — click to activate'}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  )
}

export default function StrategiesPage() {
  const navigate = useNavigate()
  const [strategies, setStrategies] = useState<StrategyListItem[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [liveCandidate, setLiveCandidate] = useState<StrategyListItem | null>(null)
  const [liveConfirmChecked, setLiveConfirmChecked] = useState(false)
  const [liveRisk, setLiveRisk] = useState<{ settings: RiskSettings | null; today: RiskCounter | null } | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<StrategyListItem | null>(null)

  const load = useCallback(() => {
    strategyApi
      .list()
      .then(setStrategies)
      .catch((err) => setError((err as Error).message))
  }, [])
  useEffect(load, [load])

  const filtered = useMemo(() => {
    if (!strategies) return null
    const q = query.trim().toLowerCase()
    if (!q) return strategies
    return strategies.filter((s) => s.name.toLowerCase().includes(q) || s.instrument.toLowerCase().includes(q))
  }, [strategies, query])

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id)
    setError(null)
    try {
      await fn()
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const toggle = (s: StrategyListItem) => void run(s.id, () => strategyApi.toggle(s.id, !s.is_active))

  const requestLive = (s: StrategyListItem) => {
    if (s.mode === 'paper') {
      setLiveCandidate(s)
      setLiveConfirmChecked(false)
      setLiveRisk(null)
      // §3.7: the confirmation modal must restate the risk settings in effect.
      appMeta
        .risk()
        .then((r) => setLiveRisk({ settings: r.settings, today: r.today }))
        .catch(() => setLiveRisk(null))
    } else {
      void run(s.id, () => strategyApi.setMode(s.id, 'paper', false))
    }
  }

  const confirmLive = () => {
    if (!liveCandidate) return
    const s = liveCandidate
    setLiveCandidate(null)
    void run(s.id, async () => {
      await strategyApi.setMode(s.id, 'live', true)
      setNotice(`"${s.name}" is now in LIVE mode (still paused — toggle to activate).`)
    })
  }

  const confirmDelete = () => {
    if (!deleteCandidate) return
    const s = deleteCandidate
    setDeleteCandidate(null)
    void run(s.id, () => strategyApi.remove(s.id))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-gray-900">My Strategies</h1>
          <p className="mt-0.5 text-sm text-gray-500">Build, version and control your rule-based strategies</p>
        </div>
        <Button onClick={() => navigate('/strategies/new')}>
          <Plus size={16} /> Create Strategy
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search strategies…"
          className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </div>

      {error && <Alert tone="red">{error}</Alert>}
      {notice && <Alert tone="green">{notice}</Alert>}

      {!filtered ? (
        <Card>
          <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="py-16 text-center">
          <p className="font-display text-lg font-semibold text-gray-900">No strategies yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
            Create your first rule-based strategy in the no-code builder, backtest it, then run it in paper mode.
          </p>
          <Button className="mt-5" onClick={() => navigate('/strategies/new')}>
            <Plus size={16} /> Create Strategy
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <Card key={s.id} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge s={s} />
                  <h3 className="truncate font-semibold text-gray-900">{s.name}</h3>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {[s.instrument, s.exchange, s.timeframe, s.rules.entry.productType].map((chip) => (
                    <span key={chip} className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      {chip}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  Trades {s.perf.total_trades} · Win rate {(s.perf.win_rate * 100).toFixed(0)}%
                  {s.perf.last_exit_time && ` · Last exit ${new Date(s.perf.last_exit_time).toLocaleDateString()}`}
                </p>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-3">
                <div className="text-right">
                  <p className={`text-sm font-bold ${pnlTone(s.perf.today_pnl)}`}>{inr(s.perf.today_pnl)}</p>
                  <p className="text-[11px] text-gray-400">today · all-time <span className={pnlTone(s.perf.total_pnl)}>{inr(s.perf.total_pnl)}</span></p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => requestLive(s)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      s.mode === 'live' ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                    title={s.mode === 'live' ? 'Live mode — click to switch back to paper' : 'Switch to live mode (requires confirmation)'}
                  >
                    {s.mode === 'live' ? 'LIVE' : 'Paper'}
                  </button>
                  <Toggle on={s.is_active} disabled={busyId === s.id} onChange={() => toggle(s)} />
                  <button onClick={() => navigate(`/strategies/${s.id}/edit`)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Edit">
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => void run(s.id, () => strategyApi.clone(s.id))} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Clone">
                    <Copy size={15} />
                  </button>
                  <button onClick={() => setDeleteCandidate(s)} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500" title="Delete">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Live-mode confirmation (spec 3.7: restate risk settings in effect) */}
      <Modal open={liveCandidate != null} onClose={() => setLiveCandidate(null)} title="Switch to LIVE mode">
        {liveCandidate && (
          <div className="space-y-4">
            <Alert tone="yellow" title="Real money orders will be placed">
              Review the risk settings that will govern this strategy before going live.
            </Alert>
            <ul className="space-y-1 text-sm text-gray-600">
              {summarizeRules(liveCandidate.rules)
                .slice(-1)
                .concat(summarizeRules(liveCandidate.rules).slice(2, -1))
                .map((line) => (
                  <li key={line}>• {line}</li>
                ))}
            </ul>

            {/* §3.7: restate the account-level risk settings actually in effect */}
            <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Account-level limits enforced on every order
              </p>
              {!liveRisk ? (
                <p className="mt-2 text-xs text-gray-400">Loading risk settings…</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm text-gray-600">
                  <li>
                    • Max daily loss:{' '}
                    {liveRisk.settings?.max_daily_loss ? (
                      inr(liveRisk.settings.max_daily_loss)
                    ) : (
                      <span className="font-semibold text-red-500">not set</span>
                    )}
                    {liveRisk.settings?.max_daily_loss != null && liveRisk.today && (
                      <span className="text-gray-400"> (used today: {inr(Math.min(0, liveRisk.today.realized_pnl))})</span>
                    )}
                  </li>
                  <li>
                    • Max trades/day: {liveRisk.settings?.max_trades_per_day ?? 'no limit'}
                    {liveRisk.today ? <span className="text-gray-400"> (used: {liveRisk.today.trades_count})</span> : null}
                  </li>
                  <li>• Max open positions: {liveRisk.settings?.max_open_positions ?? 'no limit'}</li>
                  <li>
                    • Capital allocation limit:{' '}
                    {liveRisk.settings?.capital_allocation_limit ? inr(liveRisk.settings.capital_allocation_limit) : 'not set'}
                  </li>
                  {liveRisk.settings?.kill_switch_active && (
                    <li className="font-semibold text-red-600">• Kill switch is ACTIVE — live orders are currently blocked.</li>
                  )}
                  {liveRisk.today?.is_blocked && (
                    <li className="font-semibold text-red-600">• Trading is blocked today ({liveRisk.today.blocked_reason ?? 'daily loss limit'}).</li>
                  )}
                </ul>
              )}
              {liveRisk && !liveRisk.settings?.max_daily_loss && (
                <Alert tone="yellow" title="Set a max daily loss before going live">
                  Live orders are rejected by the Risk Manager until a max daily loss is configured.{' '}
                  <button
                    className="font-semibold underline"
                    onClick={() => {
                      setLiveCandidate(null)
                      navigate('/risk')
                    }}
                  >
                    Open Risk Control →
                  </button>
                </Alert>
              )}
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={liveConfirmChecked}
                onChange={(e) => setLiveConfirmChecked(e.target.checked)}
              />
              I understand live mode places real orders through my connected Angel One account, and I accept the risk
              settings above.
            </label>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setLiveCandidate(null)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={!liveConfirmChecked} loading={busyId === liveCandidate.id} onClick={confirmLive}>
                Switch to Live
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirmation */}
      <Modal open={deleteCandidate != null} onClose={() => setDeleteCandidate(null)} title="Delete strategy?">
        <p className="text-sm leading-6 text-gray-600">
          <strong>{deleteCandidate?.name}</strong> will be permanently deleted. Historical trade logs are kept for
          reporting. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setDeleteCandidate(null)}>
            Cancel
          </Button>
          <Button variant="danger" loading={busyId === deleteCandidate?.id} onClick={confirmDelete}>
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  )
}
