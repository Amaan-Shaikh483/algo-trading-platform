import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, CheckCheck, Inbox as InboxIcon, Mail, MessageSquare, Send } from 'lucide-react'
import { Alert, Badge, Button, Card, Switch, TextInput } from '../components/ui'
import { notificationApi } from '../lib/notificationApi'
import type { ChannelPrefs, NotificationRow, PreferencesView } from '../lib/notificationApi'
import NotificationIcon from '../components/NotificationIcon'
import { notificationLabel } from '../lib/notificationMeta'
import { fmtTimeIST, relTime } from '../lib/format'
import { useRealtimeTables } from '../lib/realtime'

type Tab = 'inbox' | 'preferences'

/* ───────────────────────── Inbox tab ───────────────────────── */

function Inbox() {
  const [items, setItems] = useState<NotificationRow[] | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    notificationApi
      .list(150)
      .then(setItems)
      .catch((err) => setError((err as Error).message))
  }, [])

  useEffect(load, [load])
  useRealtimeTables(['notifications'], load)

  const types = useMemo(() => Array.from(new Set((items ?? []).map((n) => n.type))).sort(), [items])
  const unreadCount = (items ?? []).filter((n) => !n.read).length

  const filtered = useMemo(() => {
    if (!items) return null
    return items.filter((n) => {
      if (filter === 'unread' && n.read) return false
      if (typeFilter !== 'all' && n.type !== typeFilter) return false
      return true
    })
  }, [items, filter, typeFilter])

  const toggleRead = (n: NotificationRow) => {
    setItems((cur) => cur?.map((r) => (r.id === n.id ? { ...r, read: !n.read } : r)) ?? cur)
    if (!n.read) void notificationApi.markRead([n.id]).catch(() => undefined)
  }

  const markAll = () => {
    setItems((cur) => cur?.map((r) => ({ ...r, read: true })) ?? cur)
    void notificationApi.markAllRead().then(load).catch(() => undefined)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          {(['all', 'unread'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 font-medium capitalize transition-colors ${
                filter === f ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {f === 'unread' && unreadCount > 0 ? `Unread (${unreadCount})` : f}
            </button>
          ))}
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 focus:border-brand-300 focus:outline-none"
        >
          <option value="all">All event types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {notificationLabel(t)}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={markAll} disabled={unreadCount === 0}>
          <CheckCheck size={14} /> Mark all read
        </Button>
      </div>

      {error && <Alert tone="red">{error}</Alert>}

      {!filtered ? (
        <Card>
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="py-16 text-center">
          <InboxIcon size={28} className="mx-auto text-gray-300" />
          <p className="mt-3 font-display text-lg font-semibold text-gray-900">Nothing here</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
            {filter === 'unread' ? 'No unread notifications.' : 'Order, risk and engine events land here in real time.'}
          </p>
        </Card>
      ) : (
        <Card className="divide-y divide-gray-100 p-0">
          {filtered.map((n) => (
            <button
              key={n.id}
              onClick={() => toggleRead(n)}
              className={`flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50 ${
                n.read ? '' : 'bg-brand-50/40'
              }`}
            >
              <NotificationIcon type={n.type} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={`text-sm ${n.read ? 'font-medium text-gray-700' : 'font-semibold text-gray-900'}`}>
                    {n.title}
                  </span>
                  {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                </span>
                {n.body && <span className="mt-0.5 block text-sm text-gray-500">{n.body}</span>}
                <span className="mt-1 block text-xs text-gray-400" title={fmtTimeIST(n.created_at)}>
                  {relTime(n.created_at)} · {notificationLabel(n.type)}
                </span>
              </span>
            </button>
          ))}
        </Card>
      )}
    </div>
  )
}

/* ───────────────────────── Preferences tab ───────────────────────── */

function Preferences({ view, onSaved }: { view: PreferencesView; onSaved: (v: PreferencesView) => void }) {
  const [chatId, setChatId] = useState(view.prefs.telegram_chat_id ?? '')
  const [events, setEvents] = useState<Record<string, ChannelPrefs>>(view.prefs.events)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ channel: string; sent: boolean; reason?: string } | null>(null)
  const [testing, setTesting] = useState<string | null>(null)

  const setChannel = (type: string, ch: keyof ChannelPrefs, v: boolean) => {
    setEvents((cur) => ({ ...cur, [type]: { ...cur[type], [ch]: v } }))
    setNotice(null)
  }

  const dirty = useMemo(
    () => chatId !== (view.prefs.telegram_chat_id ?? '') || JSON.stringify(events) !== JSON.stringify(view.prefs.events),
    [chatId, events, view.prefs],
  )

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const saved = await notificationApi.savePrefs({ telegram_chat_id: chatId.trim() || null, events })
      onSaved(saved)
      setNotice('Notification preferences saved.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const test = async (channel: 'email' | 'telegram') => {
    setTesting(channel)
    setTestResult(null)
    try {
      if (channel === 'telegram' && chatId.trim() !== (view.prefs.telegram_chat_id ?? '')) {
        await notificationApi.savePrefs({ telegram_chat_id: chatId.trim() || null, events }).then(onSaved)
      }
      const r = await notificationApi.testChannel(channel)
      setTestResult({ channel, ...r })
    } catch (err) {
      setTestResult({ channel, sent: false, reason: (err as Error).message })
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Channel wiring status — honest about what's actually deliverable */}
      <Card>
        <h3 className="font-display text-base font-semibold text-gray-900">Channels</h3>
        <div className="mt-3 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Mail size={16} className="text-gray-400" />
              <div>
                <p className="font-medium text-gray-800">Email</p>
                <p className="text-xs text-gray-400">
                  {view.channels.emailConfigured
                    ? 'Delivery webhook configured on the backend.'
                    : 'Not configured server-side yet — toggle is saved; delivery starts once NOTIFY_EMAIL_WEBHOOK_URL is set.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={view.channels.emailConfigured ? 'green' : 'gray'}>
                {view.channels.emailConfigured ? 'configured' : 'not configured'}
              </Badge>
              <Button variant="secondary" size="sm" loading={testing === 'email'} onClick={() => void test('email')}>
                <Send size={13} /> Send test
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <MessageSquare size={16} className="text-gray-400" />
              <div>
                <p className="font-medium text-gray-800">Telegram</p>
                <p className="text-xs text-gray-400">
                  {view.channels.telegramConfigured
                    ? 'Bot token configured on the backend.'
                    : 'Not configured server-side yet — toggle is saved; delivery starts once TELEGRAM_BOT_TOKEN is set.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={view.channels.telegramConfigured ? 'green' : 'gray'}>
                {view.channels.telegramConfigured ? 'configured' : 'not configured'}
              </Badge>
              <Button variant="secondary" size="sm" loading={testing === 'telegram'} onClick={() => void test('telegram')}>
                <Send size={13} /> Send test
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-4 max-w-md">
          <TextInput
            label="Your Telegram chat ID"
            value={chatId}
            onChange={(e) => {
              setChatId(e.target.value)
              setNotice(null)
            }}
            placeholder="e.g. 123456789"
            hint="Message your bot once, then get your chat ID from @userinfobot (or getUpdates). Personal chats use your numeric user ID."
          />
        </div>
        {testResult && (
          <div className="mt-3">
            <Alert tone={testResult.sent ? 'green' : 'red'}>
              {testResult.sent
                ? `Test ${testResult.channel} notification sent — check your ${testResult.channel === 'email' ? 'inbox' : 'Telegram chat'}.`
                : `Test ${testResult.channel} failed: ${testResult.reason}`}
            </Alert>
          </div>
        )}
      </Card>

      {/* Per-event toggles (§3.9 "per-event-type channel toggle") */}
      <Card className="p-0">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="font-display text-base font-semibold text-gray-900">Per-event channels</h3>
          <p className="mt-0.5 text-xs text-gray-400">
            In-app = this notification center (realtime). Critical events are marked — keeping them on at least one channel is recommended.
          </p>
        </div>
        <div className="grid grid-cols-[1fr_repeat(3,72px)] items-center gap-x-2 px-6 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 sm:grid-cols-[1fr_repeat(3,88px)] sm:gap-x-4">
          <span className="py-1">Event</span>
          <span className="w-[72px] text-center sm:w-[88px]">In-app</span>
          <span className="w-[72px] text-center sm:w-[88px]">Email</span>
          <span className="w-[72px] text-center sm:w-[88px]">Telegram</span>
        </div>
        <div className="divide-y divide-gray-50">
          {view.events.map((ev) => (
            <div key={ev.type} className="grid grid-cols-[1fr_repeat(3,72px)] items-center gap-x-2 px-6 py-3.5 sm:grid-cols-[1fr_repeat(3,88px)] sm:gap-x-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-gray-800">
                  {ev.label}
                  {ev.critical && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-500">critical</span>}
                </p>
                <p className="mt-0.5 truncate text-xs text-gray-400">{ev.description}</p>
              </div>
              {(['in_app', 'email', 'telegram'] as const).map((ch) => (
                <div key={ch} className="flex w-[72px] justify-center sm:w-[88px]">
                  <Switch
                    on={events[ev.type]?.[ch] ?? false}
                    onChange={(v) => setChannel(ev.type, ch, v)}
                    title={`${ev.label} → ${ch.replace('_', '-')}`}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 px-6 py-4">
          {error && (
            <div className="mb-3">
              <Alert tone="red">{error}</Alert>
            </div>
          )}
          {notice && (
            <div className="mb-3">
              <Alert tone="green">{notice}</Alert>
            </div>
          )}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">Saved preferences apply to new notifications immediately.</p>
            <Button onClick={() => void save()} loading={busy} disabled={!dirty}>
              Save preferences
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

/* ───────────────────────── Page ───────────────────────── */

export default function NotificationsPage() {
  const [tab, setTab] = useState<Tab>('inbox')
  const [prefsView, setPrefsView] = useState<PreferencesView | null>(null)
  const [prefsError, setPrefsError] = useState<string | null>(null)

  useEffect(() => {
    if (tab !== 'preferences' || prefsView) return
    notificationApi
      .getPrefs()
      .then(setPrefsView)
      .catch((err) => setPrefsError((err as Error).message))
  }, [tab, prefsView])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-gray-900">Notifications</h1>
        <p className="mt-0.5 text-sm text-gray-500">Every order, risk and engine event — delivered in-app, by email and Telegram</p>
      </div>

      <div className="flex gap-1 rounded-xl border border-gray-200 bg-white p-1 text-sm shadow-sm">
        {(
          [
            { id: 'inbox', label: 'Inbox', icon: Bell },
            { id: 'preferences', label: 'Preferences', icon: CheckCheck },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${
              tab === id ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === 'inbox' ? (
        <Inbox />
      ) : prefsError ? (
        <Alert tone="red">{prefsError}</Alert>
      ) : !prefsView ? (
        <Card>
          <div className="h-40 animate-pulse rounded-xl bg-gray-100" />
        </Card>
      ) : (
        <Preferences key={prefsView.prefs.telegram_chat_id ?? 'none'} view={prefsView} onSaved={setPrefsView} />
      )}
    </div>
  )
}
