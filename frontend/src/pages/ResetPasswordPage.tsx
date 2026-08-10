import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuthStore } from '../store/authStore'
import { Alert, Button, PasswordInput } from '../components/ui'

/**
 * Spec §3.1 — landing page for the emailed recovery link: the link opens a
 * PASSWORD_RECOVERY session (authStore flag gates every other route here),
 * and this form sets the new password via updateUser.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const { session, initialized, passwordRecovery, clearPasswordRecovery } = useAuthStore()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'red' | 'green'; text: string } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setNotice(null)
    if (password.length < 6) {
      setNotice({ tone: 'red', text: 'Password must be at least 6 characters.' })
      return
    }
    if (password !== confirm) {
      setNotice({ tone: 'red', text: 'Passwords do not match.' })
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      setNotice({ tone: 'red', text: error.message })
      return
    }
    clearPasswordRecovery()
    navigate('/', { replace: true })
  }

  if (initialized && !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] p-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <p className="font-display text-lg font-semibold text-gray-900">This reset link has expired</p>
          <p className="mt-2 text-sm text-gray-500">
            Recovery links work once and expire quickly. Request a fresh one from the sign-in page.
          </p>
          <Link to="/login" className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:underline">
            Back to sign in →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <span className="font-display text-2xl font-semibold text-gray-900">
            Algo<span className="text-brand-600">Trading</span>
          </span>
          <p className="mt-1 text-sm text-gray-500">Choose a new password</p>
        </div>

        {notice && (
          <div className="mb-4">
            <Alert tone={notice.tone}>{notice.text}</Alert>
          </div>
        )}

        {!passwordRecovery && (
          <div className="mb-4">
            <Alert tone="blue" title="Opened directly?">
              This page is meant to be reached via the email recovery link — you can still set a new password while
              signed in.
            </Alert>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <PasswordInput
            label="New password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
          <PasswordInput
            label="Confirm new password"
            required
            minLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
          <Button type="submit" loading={busy} className="w-full">
            Set new password
          </Button>
        </form>
      </div>
    </div>
  )
}
