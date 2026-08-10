import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ExternalLink, KeyRound, Link2, PlugZap, RefreshCw, ShieldCheck, Trash2, Unplug } from 'lucide-react'
import { Alert, Badge, Button, Card, Modal, PasswordInput, TextInput } from '../components/ui'
import { brokerApi, readProfile } from '../lib/brokerApi'
import { appMeta } from '../lib/appMeta'
import type { BrokerCredentialsForm, BrokerStatusView } from '../lib/brokerApi'
import { ApiError } from '../lib/api'

const emptyForm: BrokerCredentialsForm = { apiKey: '', clientCode: '', mpin: '', totpSecret: '' }

type InlineResult = { tone: 'green' | 'red' | 'yellow' | 'blue'; title?: string; text: string } | null

const statusBadge: Record<BrokerStatusView['status'], { tone: 'green' | 'yellow' | 'red' | 'gray'; label: string }> = {
  connected: { tone: 'green', label: 'Connected' },
  token_expired: { tone: 'yellow', label: 'Token Expired' },
  invalid_credentials: { tone: 'red', label: 'Invalid Credentials' },
  disconnected: { tone: 'red', label: 'Disconnected' },
  not_configured: { tone: 'gray', label: 'Not Configured' },
}

/* ── TOTP help modal (spec 3.2 "how to generate TOTP secret") ────────────── */
function TotpHelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="How to get your TOTP secret">
      <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-gray-600">
        <li>
          Open the <strong>Angel One app</strong> (or web) and go to{' '}
          <strong>Profile → Settings → Security</strong>.
        </li>
        <li>
          Enable <strong>External TOTP</strong>. Angel One will show a <strong>QR code plus a secret key</strong> (a
          base32 string like <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">JBSW Y3DP EHPK 3PXP</code>).
        </li>
        <li>
          Copy the <strong>secret key text</strong> — not the QR image — and paste it into the TOTP Secret field.
        </li>
        <li>
          The platform generates fresh 6-digit codes server-side from this secret at each login; your secret itself is
          stored AES-256-GCM encrypted and is never shown back.
        </li>
      </ol>
      <div className="mt-4">
        <a
          href="https://smartapi.angelbroking.com/enable-totp"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
        >
          Angel One SmartAPI TOTP guide <ExternalLink size={14} />
        </a>
      </div>
    </Modal>
  )
}

/* ── Credentials form (also reused for retry / reconnect-after-disconnect) ── */
function CredentialsForm({
  initialClientCode,
  busyAction,
  onTest,
  onConnect,
}: {
  initialClientCode?: string
  busyAction: 'test' | 'connect' | null
  onTest: (form: BrokerCredentialsForm) => void
  onConnect: (form: BrokerCredentialsForm) => void
}) {
  const [form, setForm] = useState<BrokerCredentialsForm>({ ...emptyForm, clientCode: initialClientCode ?? '' })
  const [showHelp, setShowHelp] = useState(false)
  const set = (k: keyof BrokerCredentialsForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        onConnect(form)
      }}
    >
      <TextInput label="Angel One API Key" required value={form.apiKey} onChange={set('apiKey')} placeholder="From SmartAPI dashboard" autoComplete="off" />
      <TextInput label="Client Code" required value={form.clientCode} onChange={set('clientCode')} placeholder="e.g. A12345678" autoComplete="off" />
      <PasswordInput label="MPIN" required value={form.mpin} onChange={set('mpin')} placeholder="Your 4-digit login PIN" autoComplete="off" hint="Used once for login — never stored." />
      <div>
        <div className="flex items-center justify-between">
          <span />
          <button type="button" onClick={() => setShowHelp(true)} className="mb-1 text-xs font-medium text-brand-600 hover:underline">
            How to get this?
          </button>
        </div>
        <PasswordInput label="TOTP Secret" required value={form.totpSecret} onChange={set('totpSecret')} placeholder="Base32 secret key" autoComplete="off" hint="Stored AES-256-GCM encrypted." />
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="button" variant="secondary" loading={busyAction === 'test'} onClick={() => onTest(form)} disabled={busyAction === 'connect'}>
          <PlugZap size={16} /> Test Connection
        </Button>
        <Button type="submit" loading={busyAction === 'connect'} disabled={busyAction === 'test'}>
          <Link2 size={16} /> Connect &amp; Save
        </Button>
        <p className="text-xs text-gray-400">Test verifies your credentials with Angel One before anything is saved.</p>
      </div>
      <TotpHelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </form>
  )
}

/* ── Main page ────────────────────────────────────────────────────────────── */
export default function BrokerConnectPage() {
  const [status, setStatus] = useState<BrokerStatusView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<'test' | 'connect' | 'reconnect' | 'disconnect' | 'remove' | null>(null)
  const [result, setResult] = useState<InlineResult>(null)
  const [editing, setEditing] = useState(false)
  const [reconnectMpin, setReconnectMpin] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  const load = useCallback(async () => {
    try {
      appMeta.invalidateBroker()
      setStatus(await brokerApi.status())
    } catch (err) {
      setResult({ tone: 'red', text: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => void load(), [load])

  const run = async (action: NonNullable<typeof busyAction>, fn: () => Promise<void>) => {
    setBusyAction(action)
    setResult(null)
    try {
      await fn()
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message
      setResult({ tone: 'red', title: 'Action failed', text: msg })
    } finally {
      setBusyAction(null)
    }
  }

  const handleTest = (form: BrokerCredentialsForm) =>
    void run('test', async () => {
      const { profile } = await brokerApi.test(form)
      const p = readProfile(profile)
      setResult({
        tone: 'green',
        title: 'Connection successful',
        text: `Authenticated as ${p.name} (${p.clientCode}). Nothing was saved yet — click Connect & Save to persist.`,
      })
    })

  const handleConnect = (form: BrokerCredentialsForm) =>
    void run('connect', async () => {
      await brokerApi.connect(form)
      appMeta.invalidateBroker()
      setEditing(false)
      setResult({ tone: 'green', title: 'Broker connected', text: 'Credentials saved encrypted and a live session is active for the trading day.' })
      await load()
    })

  const handleReconnect = (e: FormEvent) => {
    e.preventDefault()
    void run('reconnect', async () => {
      await brokerApi.reconnect(reconnectMpin)
      appMeta.invalidateBroker()
      setReconnectMpin('')
      setResult({ tone: 'green', title: 'Session refreshed', text: 'A fresh trading-day session is now active.' })
      await load()
    })
  }

  const handleDisconnect = () =>
    void run('disconnect', async () => {
      await brokerApi.disconnect()
      appMeta.invalidateBroker()
      setResult({ tone: 'blue', text: 'Broker disconnected. Credentials remain saved for a quick reconnect; all order/strategy history is preserved.' })
      await load()
    })

  const handleRemove = () => {
    setConfirmRemove(false)
    void run('remove', async () => {
      await brokerApi.remove()
      appMeta.invalidateBroker()
      setResult({ tone: 'blue', text: 'Connection removed, including stored credentials. Historical data is unaffected.' })
      await load()
    })
  }

  const badge = status ? statusBadge[status.status] : statusBadge.not_configured
  const profile = readProfile(status?.brokerProfile)
  const showForm =
    status && (!status.configured || editing || status.status === 'invalid_credentials' || status.status === 'disconnected')

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header + status badge */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-gray-900">Connect Broker</h1>
          <p className="mt-0.5 text-sm text-gray-500">Angel One SmartAPI — one connection per account</p>
        </div>
        {!loading && <Badge tone={badge.tone}>{badge.label}</Badge>}
      </div>

      {result && (
        <Alert tone={result.tone} title={result.title}>
          {result.text}
        </Alert>
      )}

      {loading ? (
        <Card>
          <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
        </Card>
      ) : showForm ? (
        <Card>
          <div className="mb-5 flex items-start gap-3">
            <div className="rounded-xl bg-brand-50 p-2.5 text-brand-600">
              <KeyRound size={20} />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">
                {status?.status === 'invalid_credentials' ? 'Update credentials & retry' : 'Angel One credentials'}
              </h2>
              <p className="mt-0.5 text-sm text-gray-500">
                {status?.status === 'invalid_credentials'
                  ? 'Angel One rejected the stored credentials. Correct them below and connect again.'
                  : status?.status === 'disconnected' && status.configured
                    ? 'Your credentials are saved encrypted. Re-enter them to reconnect, or test first.'
                    : 'From the Angel One SmartAPI dashboard. Secrets are encrypted server-side and never shown again.'}
              </p>
            </div>
          </div>
          <CredentialsForm
            initialClientCode={status?.clientCode ?? ''}
            busyAction={busyAction === 'test' || busyAction === 'connect' ? busyAction : null}
            onTest={handleTest}
            onConnect={handleConnect}
          />
        </Card>
      ) : (
        <>
          {/* Connected / token-expired status card */}
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-gray-900">Angel One (SmartAPI)</h2>
                <p className="mt-0.5 text-sm text-gray-500">Client {status?.clientCode ?? '—'}</p>
              </div>
              <Badge tone={badge.tone}>{badge.label}</Badge>
            </div>

            {status?.lastError && (
              <div className="mt-4">
                <Alert tone={status.status === 'invalid_credentials' ? 'red' : 'yellow'}>
                  {status.lastError}
                </Alert>
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Broker-side name</p>
                <p className="mt-1 font-semibold text-gray-900">{profile.name}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Session valid until</p>
                <p className="mt-1 font-semibold text-gray-900">
                  {status?.tokenExpiry ? new Date(status.tokenExpiry).toLocaleString() : '—'}
                </p>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Exchanges enabled</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {profile.exchanges.length ? (
                    profile.exchanges.map((x) => (
                      <span key={x} className="rounded-md bg-white px-2 py-1 text-xs font-medium text-gray-600 shadow-sm">
                        {x}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
                  )}
                </div>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Products enabled</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {profile.products.length ? (
                    profile.products.map((x) => (
                      <span key={x} className="rounded-md bg-white px-2 py-1 text-xs font-medium text-gray-600 shadow-sm">
                        {x}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-5">
              {status?.status !== 'disconnected' && (
                <Button variant="secondary" loading={busyAction === 'disconnect'} onClick={handleDisconnect}>
                  <Unplug size={15} /> Disconnect
                </Button>
              )}
              <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setConfirmRemove(true)}>
                <Trash2 size={15} /> Remove Connection
              </Button>
              <p className="text-xs text-gray-400">
                Disconnect keeps credentials + history. Remove deletes stored credentials too — orders/strategies are never
                touched either way.
              </p>
            </div>
          </Card>

          {/* Token expired → MPIN-only reconnect */}
          {status?.status === 'token_expired' && (
            <Card>
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-amber-50 p-2.5 text-amber-600">
                  <RefreshCw size={20} />
                </div>
                <div className="flex-1">
                  <h2 className="font-semibold text-gray-900">Reconnect session</h2>
                  <p className="mt-0.5 text-sm text-gray-500">
                    SmartAPI tokens last one trading day. Enter your MPIN to mint a fresh session — everything else is
                    already saved.
                  </p>
                  <form onSubmit={handleReconnect} className="mt-4 flex max-w-sm items-end gap-3">
                    <div className="flex-1">
                      <PasswordInput
                        label="MPIN"
                        required
                        value={reconnectMpin}
                        onChange={(e) => setReconnectMpin(e.target.value)}
                        placeholder="4-digit PIN"
                        autoComplete="off"
                      />
                    </div>
                    <Button type="submit" loading={busyAction === 'reconnect'}>
                      Reconnect
                    </Button>
                  </form>
                </div>
              </div>
            </Card>
          )}

          {/* Security note */}
          <Card className="flex items-start gap-3">
            <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
              <ShieldCheck size={20} />
            </div>
            <p className="text-sm leading-6 text-gray-500">
              API key and TOTP secret are AES-256-GCM encrypted with a server-only key before storage; your MPIN is used
              once at login and never persisted. Tokens are refreshed automatically every morning at 08:00 IST.
            </p>
          </Card>
        </>
      )}

      {/* Remove confirmation */}
      <Modal open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Remove broker connection?">
        <p className="text-sm leading-6 text-gray-600">
          This deletes the stored encrypted credentials and all session tokens. Your order history, strategies and trade
          logs are kept. You can reconnect anytime by entering credentials again.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={busyAction === 'remove'} onClick={handleRemove}>
            Remove Connection
          </Button>
        </div>
      </Modal>
    </div>
  )
}
