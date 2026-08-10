import { notificationMeta, notificationToneClasses } from '../lib/notificationMeta'

/** Circular tone-tinted icon chip for a notification row (see lib/notificationMeta). */
export default function NotificationIcon({ type, size = 15 }: { type: string; size?: number }) {
  const m = notificationMeta(type)
  const Icon = m.icon
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${notificationToneClasses[m.tone]}`}>
      <Icon size={size} />
    </span>
  )
}
