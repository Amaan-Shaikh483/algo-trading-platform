import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuthStore } from '../store/authStore'
import { Alert, Button, PasswordInput, TextInput } from '../components/ui'

type Mode = 'signin' | 'signup'

/**
 * Spec §3.1 — email + password auth via Supabase (Google OAuth as secondary
 * option; enable the Google provider in the Supabase dashboard to activate).
 * Password recovery lands on /reset-password (allow that redirect URL in the
 * Supabase dashboard auth settings).
 */
export default function LoginPage() {
  const navigate = useNavigate()
  const { session, initialized } = useAuthStore()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'red' | 'green' | 'blue'; text: string } | null>(null)

  if (initialized && session) return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        navigate('/', { replace: true })
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        })
        if (error) throw error
        if (data.session) {
          navigate('/', { replace: true })
        } else {
          setNotice({ tone: 'green', text: 'Account created — check your email to confirm your address, then sign in.' })
          setMode('signin')
        }
      }
    } catch (err) {
      setNotice({ tone: 'red', text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const forgotPassword = async () => {
    if (!email) {
      setNotice({ tone: 'blue', text: 'Enter your email above first, then click “Forgot password”.' })
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setNotice(
      error
        ? { tone: 'red', text: error.message }
        : { tone: 'green', text: 'Password reset email sent — check your inbox.' },
    )
  }

  const google = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setNotice({ tone: 'red', text: `Google sign-in unavailable: ${error.message}` })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <span className="font-display text-2xl font-semibold text-gray-900">
            Algo<span className="text-brand-600">Trading</span>
          </span>
          <p className="mt-1 text-sm text-gray-500">
            {mode === 'signin' ? 'Sign in to your trading workspace' : 'Create your trading account'}
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 rounded-xl bg-gray-100 p-1 text-sm font-medium">
          {(['signin', 'signup'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m)
                setNotice(null)
              }}
              className={`rounded-lg py-2 transition-colors ${
                mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {m === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>

        {notice && (
          <div className="mb-4">
            <Alert tone={notice.tone}>{notice.text}</Alert>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          {mode === 'signup' && (
            <TextInput
              label="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />
          )}
          <TextInput
            label="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
          <PasswordInput
            label="Password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
          {mode === 'signin' && (
            <div className="text-right">
              <button type="button" onClick={forgotPassword} className="text-xs font-medium text-brand-600 hover:underline">
                Forgot password?
              </button>
            </div>
          )}
          <Button type="submit" loading={busy} className="w-full">
            {mode === 'signin' ? 'Sign In' : 'Create Account'}
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-gray-400">
          <div className="h-px flex-1 bg-gray-200" />
          OR
          <div className="h-px flex-1 bg-gray-200" />
        </div>
        <Button variant="secondary" className="w-full" onClick={google}>
          Continue with Google
        </Button>
      </div>
    </div>
  )
}
