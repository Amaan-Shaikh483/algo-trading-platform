import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import StrategiesPage from './pages/StrategiesPage'
import StrategyBuilderPage from './pages/builder/StrategyBuilderPage'
import BacktestPage from './pages/BacktestPage'
import WatchlistPage from './pages/WatchlistPage'
import BrokerConnectPage from './pages/BrokerConnectPage'
import RiskPage from './pages/RiskPage'
import NotificationsPage from './pages/NotificationsPage'
import ProfilePage from './pages/ProfilePage'
import LoginPage from './pages/LoginPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import { useAuthStore } from './store/authStore'
import { Loader2 } from 'lucide-react'

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb]">
      <Loader2 className="animate-spin text-brand-600" size={32} />
    </div>
  )
}

/** Everything behind this gate requires an authenticated Supabase session (§3.1). */
function Protected({ children }: { children: ReactNode }) {
  const { initialized, session, passwordRecovery } = useAuthStore()
  const location = useLocation()
  if (!initialized) return <Splash />
  // A recovery-link session must complete the password reset before anything else.
  if (passwordRecovery && location.pathname !== '/reset-password') {
    return <Navigate to="/reset-password" replace />
  }
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const init = useAuthStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="strategies" element={<StrategiesPage />} />
          <Route path="strategies/new" element={<StrategyBuilderPage />} />
          <Route path="strategies/:id/edit" element={<StrategyBuilderPage />} />
          <Route path="backtest" element={<BacktestPage />} />
          <Route path="watchlist" element={<WatchlistPage />} />
          <Route path="broker" element={<BrokerConnectPage />} />
          <Route path="risk" element={<RiskPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
