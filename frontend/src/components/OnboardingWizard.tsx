import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Circle, PartyPopper } from 'lucide-react'
import { Alert, Button, Modal, TextInput } from './ui'
import { supabase } from '../lib/supabaseClient'
import { useAuthStore } from '../store/authStore'
import { appMeta } from '../lib/appMeta'
import type { BrokerStatusView } from '../lib/brokerApi'

/**
 * Spec §3.1 first-login wizard: shown over any screen until
 * profiles.onboarding_completed = true (or snoozed for the session).
 * A live checklist of the three things a trader needs before paper/live:
 * profile basics → broker connected → risk limits configured.
 */
export default function OnboardingWizard() {
  const { user, profile, refreshProfile } = useAuthStore()
  const navigate = useNavigate()
  const [snoozed, setSnoozed] = useState(() => sessionStorage.getItem('onboarding_snoozed') === '1')
  const [name, setName] = useState('')
  const [level, setLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner')
  const [broker, setBroker] = useState<BrokerStatusView | null>(null)
  const [riskOk, setRiskOk] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<'basics' | 'finish' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = !!profile && !profile.onboarding_completed && !snoozed

  useEffect(() => {
    if (!open) return
    setName(profile?.full_name ?? '')
    setLevel((profile?.experience_level as 'beginner' | 'intermediate' | 'advanced') ?? 'beginner')
    appMeta.brokerStatus().then(setBroker).catch(() => setBroker(null))
    appMeta
      .risk()
      .then((r) => setRiskOk(r.settings?.max_daily_loss != null))
      .catch(() => setRiskOk(null))
    // profile arrives after mount; re-seed the form when fields load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile?.full_name, profile?.experience_level])

  if (!open) return null

  const snooze = () => {
    sessionStorage.setItem('onboarding_snoozed', '1')
    setSnoozed(true)
  }

  const basicsDone = (profile?.full_name ?? name.trim()) !== ''
  const brokerDone = broker?.status === 'connected'

  const saveBasics = async () => {
    if (!user) return
    setBusy('basics')
    setError(null)
    const { error: err } = await supabase
      .from('profiles')
      .update({ full_name: name.trim() || null, experience_level: level })
      .eq('id', user.id)
    setBusy(null)
    if (err) {
      setError(err.message)
      return
    }
    await refreshProfile()
  }

  const finish = async () => {
    if (!user) return
    setBusy('finish')
    setError(null)
    const { error: err } = await supabase.from('profiles').update({ onboarding_completed: true }).eq('id', user.id)
    if (err) {
      setBusy(null)
      setError(err.message)
      return
    }
    await refreshProfile() // flag flips → wizard closes
    setBusy(null)
  }

  return (
    <Modal open onClose={snooze} title="Welcome — let's set up your workspace">
      <div className="space-y-4">
        {error && <Alert tone="red">{error}</Alert>}

        {/* 1. basics */}
        <div className="rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            {basicsDone ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} className="text-gray-300" />}
            1 · Your profile
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Experience</span>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as typeof level)}
                className="w-full rounded-lg border border-gray-200 bg-gray-50/60 px-3.5 py-2.5 text-sm focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
              >
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="secondary" size="sm" loading={busy === 'basics'} onClick={() => void saveBasics()}>
              Save
            </Button>
          </div>
        </div>

        {/* 2. broker */}
        <div className="rounded-xl border border-gray-100 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              {brokerDone ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} className="text-gray-300" />}
              2 · Connect your Angel One broker
            </div>
            {!brokerDone && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  snooze()
                  navigate('/broker')
                }}
              >
                Open Connect Broker
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {brokerDone
              ? `Connected${broker?.clientCode ? ` as ${broker.clientCode}` : ''} — live data and order routing are ready.`
              : 'API key + client code + MPIN + TOTP secret. MPIN is used once at login and never stored.'}
          </p>
        </div>

        {/* 3. risk limits */}
        <div className="rounded-xl border border-gray-100 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              {riskOk ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} className="text-gray-300" />}
              3 · Set account risk limits
            </div>
            {!riskOk && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  snooze()
                  navigate('/risk')
                }}
              >
                Open Risk Control
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {riskOk
              ? 'A max daily loss is configured — live mode is unlocked.'
              : 'A max daily loss is required before any strategy can run in LIVE mode. Paper mode works without it.'}
          </p>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 pt-4">
          <button onClick={snooze} className="text-xs font-medium text-gray-400 hover:text-gray-600">
            Skip for now
          </button>
          <Button loading={busy === 'finish'} onClick={() => void finish()}>
            <PartyPopper size={15} /> Finish setup
          </Button>
        </div>
        <p className="text-center text-[11px] text-gray-400">
          Finish whenever you're ready — everything above stays reachable from the sidebar.
        </p>
      </div>
    </Modal>
  )
}
