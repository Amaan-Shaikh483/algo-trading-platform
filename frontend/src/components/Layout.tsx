import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Cable,
  Eye,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  ScrollText,
  ShieldAlert,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { appMeta } from '../lib/appMeta'
import type { BrokerStatusView } from '../lib/brokerApi'
import KillSwitchButton from './KillSwitchButton'
import NotificationBell from './NotificationBell'
import OnboardingWizard from './OnboardingWizard'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/broker', label: 'Broker', icon: Cable },
  { to: '/strategies', label: 'Strategies', icon: ScrollText },
  { to: '/backtest', label: 'Backtesting', icon: FlaskConical },
  { to: '/watchlist', label: 'Watchlist', icon: Eye },
  { to: '/risk', label: 'Risk', icon: ShieldAlert },
]

const statusDot: Record<string, string> = {
  connected: 'bg-emerald-500',
  token_expired: 'bg-amber-500',
  invalid_credentials: 'bg-red-500',
  disconnected: 'bg-gray-400',
  not_configured: 'bg-gray-400',
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <svg viewBox="0 0 24 24" className="h-7 w-7 text-brand-600" fill="currentColor" aria-hidden>
        <path d="M21.9 2.1a1.2 1.2 0 0 0-1.3-.3L2.8 9.9a1.2 1.2 0 0 0 .1 2.3l7.4 2.1 2.1 7.4a1.2 1.2 0 0 0 2.3.1l7.4-17.8c.2-.6 0-1.4-.2-1.9ZM10 13.1 5 11.6 18.4 5.6 10 13.1Zm2.4 6.4-1.5-5 7.5-8.4-6 13.4Z" />
      </svg>
      <span className="font-display text-xl font-semibold text-gray-900">
        Algo<span className="text-brand-600">Trading</span>
      </span>
    </div>
  )
}

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile, signOut } = useAuthStore()
  const [broker, setBroker] = useState<BrokerStatusView | null>(null)

  // Sidebar broker dot: refetch on every navigation (appMeta single-flight +
  // TTL shares it with the other widgets, so this is ≤1 real request/5s).
  useEffect(() => {
    appMeta.brokerStatus().then(setBroker).catch(() => setBroker(null))
  }, [location.pathname])

  const initials = (profile?.full_name ?? user?.email ?? '?')
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')

  return (
    <div className="flex min-h-screen bg-[#f4f6fb] text-gray-900">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-gray-200/80 bg-white">
        <Brand />
        <nav className="flex-1 space-y-1 px-3">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User card (per reference: avatar, name, client id) */}
        <div className="m-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700">
              {initials || 'U'}
              {broker && (
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${statusDot[broker.status] ?? 'bg-gray-400'}`}
                  title={`Broker: ${broker.status}`}
                />
              )}
            </div>
            <Link to="/profile" className="min-w-0 flex-1 rounded-md" title="Open your profile">
              <p className="truncate text-sm font-semibold text-gray-900 hover:text-brand-700">
                {profile?.full_name ?? 'Trader'}
              </p>
              <p className="truncate text-xs text-gray-400">{broker?.clientCode ?? user?.email ?? ''}</p>
            </Link>
            <button
              onClick={() => void signOut().then(() => navigate('/login'))}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-gray-600"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-end gap-3 border-b border-gray-200/80 bg-white px-6">
          <KillSwitchButton />
          <NotificationBell />
        </header>
        <main className="flex-1 px-6 py-6">
          <Outlet />
        </main>
      </div>

      {/* §3.1 first-login wizard (self-hides once onboarding_completed) */}
      <OnboardingWizard />
    </div>
  )
}
