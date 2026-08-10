import {
  ArrowLeftRight,
  Bell,
  CheckCircle2,
  FlaskConical,
  KeyRound,
  OctagonAlert,
  Send,
  ShieldAlert,
  Target,
  TrendingDown,
  TriangleAlert,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** Icon + tone metadata for each §3.9 notification type (bell + inbox page). */

export type NotificationTone = 'red' | 'amber' | 'emerald' | 'blue' | 'gray'

export const notificationToneClasses: Record<NotificationTone, string> = {
  red: 'bg-red-100 text-red-600',
  amber: 'bg-amber-100 text-amber-600',
  emerald: 'bg-emerald-100 text-emerald-600',
  blue: 'bg-brand-100 text-brand-600',
  gray: 'bg-gray-100 text-gray-500',
}

const meta: Record<string, { icon: LucideIcon; tone: NotificationTone; label: string }> = {
  order_placed: { icon: Send, tone: 'blue', label: 'Order placed' },
  order_filled: { icon: CheckCircle2, tone: 'emerald', label: 'Order filled' },
  order_rejected: { icon: XCircle, tone: 'red', label: 'Order rejected / blocked' },
  sl_hit: { icon: TrendingDown, tone: 'amber', label: 'Stop-loss hit' },
  target_hit: { icon: Target, tone: 'emerald', label: 'Target hit' },
  daily_loss_limit: { icon: ShieldAlert, tone: 'red', label: 'Daily loss limit' },
  strategy_error: { icon: TriangleAlert, tone: 'red', label: 'Strategy error' },
  token_expired: { icon: KeyRound, tone: 'red', label: 'Broker token expired' },
  kill_switch: { icon: OctagonAlert, tone: 'red', label: 'Kill switch' },
  backtest_completed: { icon: FlaskConical, tone: 'blue', label: 'Backtest completed' },
  reconciliation_drift: { icon: ArrowLeftRight, tone: 'amber', label: 'Reconciliation drift' },
}

export function notificationMeta(type: string): { icon: LucideIcon; tone: NotificationTone; label: string } {
  return meta[type] ?? { icon: Bell, tone: 'gray', label: type.replace(/_/g, ' ') }
}

export function notificationLabel(type: string): string {
  return notificationMeta(type).label
}
