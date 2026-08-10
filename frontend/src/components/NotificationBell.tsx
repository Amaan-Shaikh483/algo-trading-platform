import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import { notificationApi } from '../lib/notificationApi'
import type { NotificationRow } from '../lib/notificationApi'
import NotificationIcon from './NotificationIcon'
import { relTime } from '../lib/format'
import { useRealtimeTables } from '../lib/realtime'

/**
 * §3.9 in-app notification center, header entry point: unread badge (pushed
 * live via the `notifications` realtime publication — no polling) + dropdown
 * with the latest events; "View all" lands on the full Notifications page.
 */
export default function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationRow[]>([])
  const [unread, setUnread] = useState(0)
  const [ready, setReady] = useState(false)

  const load = useCallback(() => {
    Promise.all([notificationApi.list(6), notificationApi.unreadCount()])
      .then(([rows, count]) => {
        setItems(rows)
        setUnread(count)
        setReady(true)
      })
      .catch(() => setReady(true))
  }, [])

  useEffect(load, [load])
  useRealtimeTables(['notifications'], load)

  const openDropdown = () => {
    setOpen((v) => !v)
    load()
  }

  const openItem = (n: NotificationRow) => {
    if (!n.read) {
      setItems((cur) => cur.map((r) => (r.id === n.id ? { ...r, read: true } : r)))
      setUnread((c) => Math.max(0, c - 1))
      void notificationApi.markRead([n.id]).catch(() => undefined)
    }
  }

  const markAll = () => {
    setItems((cur) => cur.map((r) => ({ ...r, read: true })))
    setUnread(0)
    void notificationApi.markAllRead().then(load).catch(() => undefined)
  }

  return (
    <div className="relative">
      <button
        onClick={openDropdown}
        className="relative rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        title={unread > 0 ? `${unread} unread notification${unread > 1 ? 's' : ''}` : 'Notifications'}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-96 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <p className="font-display text-sm font-semibold text-gray-900">Notifications</p>
              <button
                onClick={markAll}
                disabled={unread === 0}
                className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-gray-300"
              >
                <CheckCheck size={13} /> Mark all read
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {!ready ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Bell size={20} className="mx-auto text-gray-300" />
                  <p className="mt-2 text-sm font-medium text-gray-500">All caught up</p>
                  <p className="mt-0.5 text-xs text-gray-400">Order, risk and engine events will appear here.</p>
                </div>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => openItem(n)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                      n.read ? '' : 'bg-brand-50/50'
                    }`}
                  >
                    <NotificationIcon type={n.type} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={`truncate text-sm ${n.read ? 'font-medium text-gray-700' : 'font-semibold text-gray-900'}`}>
                          {n.title}
                        </span>
                        {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                      </span>
                      {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-gray-500">{n.body}</span>}
                      <span className="mt-1 block text-[11px] text-gray-400">{relTime(n.created_at)}</span>
                    </span>
                  </button>
                ))
              )}
            </div>

            <button
              onClick={() => {
                setOpen(false)
                navigate('/notifications')
              }}
              className="block w-full border-t border-gray-100 px-4 py-2.5 text-center text-xs font-semibold text-brand-600 hover:bg-gray-50"
            >
              View all notifications
            </button>
          </div>
        </>
      )}
    </div>
  )
}
