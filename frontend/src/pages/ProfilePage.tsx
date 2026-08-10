import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { BadgeCheck, KeyRound, UserRound } from 'lucide-react'
import { Alert, Badge, Button, Card, PasswordInput, TextInput } from '../components/ui'
import { supabase } from '../lib/supabaseClient'
import { useAuthStore } from '../store/authStore'
import { fmtDateIST } from '../lib/format'

/**
 * Spec §3.1 profile page: name, phone, timezone, trading experience level
 * (beginner/intermediate/advanced — tune UI guidance), plus account identity
 * and a password change. Writes go straight to `profiles` (RLS: own row).
 */

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
]

const LEVELS = [
  {
    key: 'beginner',
    title: 'Beginner',
    desc: 'New to algo trading — the app shows extra guidance and nudges you to prove strategies in paper mode first.',
  },
  {
    key: 'intermediate',
    title: 'Intermediate',
    desc: 'Comfortable with indicators and backtesting; standard interface.',
  },
  {
    key: 'advanced',
    title: 'Advanced',
    desc: 'You know the risks cold — guidance hints are hidden.',
  },
] as const

interface ProfileRow {
  full_name: string | null
  phone: string | null
  timezone: string
  experience_level: 'beginner' | 'intermediate' | 'advanced'
  role: 'user' | 'admin'
  onboarding_completed: boolean
  created_at: string
}

export default function ProfilePage() {
  const { user, profile, refreshProfile } = useAuthStore()
  const [row, setRow] = useState<ProfileRow | null>(null)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [timezone, setTimezone] = useState('Asia/Kolkata')
  const [level, setLevel] = useState<ProfileRow['experience_level']>('beginner')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'red' | 'green'; text: string } | null>(null)
  const [pw, setPw] = useState({ next: '', confirm: '' })
  const [pwBusy, setPwBusy] = useState(false)
  const [pwNotice, setPwNotice] = useState<{ tone: 'red' | 'green'; text: string } | null>(null)

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setNotice({ tone: 'red', text: error.message })
          return
        }
        const r = data as unknown as ProfileRow | null
        if (r) {
          setRow(r)
          setFullName(r.full_name ?? '')
          setPhone(r.phone ?? '')
          setTimezone(r.timezone || 'Asia/Kolkata')
          setLevel(r.experience_level)
        }
      })
  }, [user])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    setNotice(null)
    if (phone.trim() && !/^\+?[\d\s-]{8,16}$/.test(phone.trim())) {
      setNotice({ tone: 'red', text: 'Phone number looks invalid — use digits with an optional country code.' })
      return
    }
    setBusy(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        timezone,
        experience_level: level,
      })
      .eq('id', user.id)
    setBusy(false)
    if (error) {
      setNotice({ tone: 'red', text: error.message })
      return
    }
    await refreshProfile()
    setRow((r) => r && { ...r, full_name: fullName.trim() || null, phone: phone.trim() || null, timezone, experience_level: level })
    setDirty(false)
    setNotice({ tone: 'green', text: 'Profile saved.' })
  }

  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    setPwNotice(null)
    if (pw.next.length < 6) {
      setPwNotice({ tone: 'red', text: 'Password must be at least 6 characters.' })
      return
    }
    if (pw.next !== pw.confirm) {
      setPwNotice({ tone: 'red', text: 'Passwords do not match.' })
      return
    }
    setPwBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw.next })
    setPwBusy(false)
    if (error) {
      setPwNotice({ tone: 'red', text: error.message })
      return
    }
    setPw({ next: '', confirm: '' })
    setPwNotice({ tone: 'green', text: 'Password updated — it applies to your next sign-in.' })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-gray-900">Profile</h1>
        <p className="mt-0.5 text-sm text-gray-500">Your account details and trading preferences (§3.1)</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Identity card */}
        <Card>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-700">
              <UserRound size={22} />
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold text-gray-900">{profile?.full_name ?? 'Trader'}</p>
              <p className="truncate text-sm text-gray-500">{user?.email}</p>
            </div>
          </div>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Role</dt>
              <dd>
                <Badge tone={row?.role === 'admin' ? 'blue' : 'gray'}>{row?.role ?? 'user'}</Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Member since</dt>
              <dd className="font-medium text-gray-800">{row ? fmtDateIST(row.created_at) : '—'}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Onboarding</dt>
              <dd>
                {row?.onboarding_completed ? (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <BadgeCheck size={14} /> complete
                  </span>
                ) : (
                  <span className="text-amber-600">pending — the setup wizard will appear on your screens</span>
                )}
              </dd>
            </div>
          </dl>
        </Card>

        {/* Editable profile form */}
        <Card className="lg:col-span-2">
          <h3 className="font-display text-base font-semibold text-gray-900">Details & preferences</h3>
          <form onSubmit={save} className="mt-4 space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextInput label="Full name" value={fullName} onChange={(e) => { setFullName(e.target.value); setDirty(true) }} placeholder="Your name" autoComplete="name" />
              <TextInput label="Phone" value={phone} onChange={(e) => { setPhone(e.target.value); setDirty(true) }} placeholder="+91 …" autoComplete="tel" />
            </div>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Timezone</span>
              <select
                value={timezone}
                onChange={(e) => { setTimezone(e.target.value); setDirty(true) }}
                className="w-full rounded-lg border border-gray-200 bg-gray-50/60 px-3.5 py-2.5 text-sm focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-gray-400">
                Trading screens always show IST (NSE market time); your timezone is stored for account-facing features.
              </span>
            </label>

            <div>
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Trading experience level</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {LEVELS.map((l) => (
                  <button
                    type="button"
                    key={l.key}
                    onClick={() => { setLevel(l.key); setDirty(true) }}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      level === l.key ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className={`text-sm font-semibold ${level === l.key ? 'text-brand-700' : 'text-gray-800'}`}>{l.title}</p>
                    <p className="mt-1 text-xs leading-4 text-gray-500">{l.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
            <div className="flex justify-end">
              <Button type="submit" loading={busy} disabled={!dirty}>
                Save profile
              </Button>
            </div>
          </form>
        </Card>
      </div>

      {/* Password */}
      <Card className="max-w-2xl">
        <div className="flex items-center gap-2">
          <KeyRound size={17} className="text-brand-600" />
          <h3 className="font-display text-base font-semibold text-gray-900">Change password</h3>
        </div>
        <form onSubmit={changePassword} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PasswordInput label="New password" required minLength={6} value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} autoComplete="new-password" />
            <PasswordInput label="Confirm new password" required minLength={6} value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} autoComplete="new-password" />
          </div>
          {pwNotice && <Alert tone={pwNotice.tone}>{pwNotice.text}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" loading={pwBusy} disabled={!pw.next && !pw.confirm}>
              Update password
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
