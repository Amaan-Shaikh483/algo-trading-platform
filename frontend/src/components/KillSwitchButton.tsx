import { useEffect, useState } from 'react'
import { OctagonAlert, ShieldCheck } from 'lucide-react'
import { Alert, Button, Modal } from './ui'
import { riskApi } from '../lib/riskApi'
import type { KillSwitchSummary } from '../lib/riskApi'
import { appMeta } from '../lib/appMeta'

/**
 * §3.7 emergency "Stop All & Square Off" — pinned in the global header so it
 * is reachable from ANY screen. Red when armed; shows ACTIVE state with a
 * release action when the switch is on (strategies stay paused either way).
 */
export default function KillSwitchButton() {
  const [active, setActive] = useState<boolean | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<KillSwitchSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    appMeta
      .risk()
      .then((r) => setActive(r.settings?.kill_switch_active ?? false))
      .catch(() => setActive(null))
  }, [])

  const activate = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await riskApi.killSwitch(true)
      appMeta.invalidateRisk()
      setActive(true)
      setResult(r.summary ?? null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const release = async () => {
    setBusy(true)
    try {
      await riskApi.killSwitch(false)
      appMeta.invalidateRisk()
      setActive(false)
      setResult(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
          active
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
        }`}
        title={active ? 'Kill switch ACTIVE — new entries are halted' : 'Emergency: stop all strategies & square off all positions'}
      >
        <OctagonAlert size={14} />
        {active ? 'KILL ACTIVE' : 'KILL SWITCH'}
      </button>

      <Modal open={confirming} onClose={() => !busy && setConfirming(false)} title={active ? 'Kill switch is active' : 'Stop All & Square Off?'}>
        {error && (
          <div className="mb-3">
            <Alert tone="red">{error}</Alert>
          </div>
        )}
        {active ? (
          <div className="space-y-4">
            <Alert tone="red" title="Trading is halted">
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>All strategies are deactivated and every new entry is blocked by the risk manager.</li>
                {result && (
                  <li>
                    Last run: {result.strategiesDeactivated} strategies stopped · {result.liveSquareOffs.ok + result.paperPositionsClosed}{' '}
                    positions squared off
                    {result.liveSquareOffs.failed.length > 0 && ` · ${result.liveSquareOffs.failed.length} square-offs still failing (worker retries automatically)`}
                  </li>
                )}
              </ul>
            </Alert>
            <p className="text-sm text-gray-500">
              Releasing the switch only re-enables NEW entries — strategies stay paused until you re-activate them individually.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Close
              </Button>
              <Button variant="secondary" onClick={release} loading={busy}>
                <ShieldCheck size={15} /> Release kill switch
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert tone="red" title="This is the emergency brake. It will immediately:">
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>Deactivate <strong>all</strong> strategies (live and paper).</li>
                <li>Block every new entry at the risk manager.</li>
                <li>Place square-off orders for <strong>all open live positions</strong> and close paper positions at market.</li>
              </ul>
            </Alert>
            <p className="text-sm text-gray-500">Use only to flatten the whole account. You can release the switch afterwards, but strategies must be re-activated manually.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" onClick={activate} loading={busy}>
                <OctagonAlert size={15} /> Stop All & Square Off
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
