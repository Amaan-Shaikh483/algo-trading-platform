/* Shared INR / IST formatting helpers (spec-wide UI conventions). */

export const inr = (v: number) => `${v < 0 ? '−' : ''}₹${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
export const pct = (v: number, digits = 2) => `${v.toLocaleString('en-IN', { maximumFractionDigits: digits })}%`
export const pnlTone = (v: number) => (v > 0 ? 'text-emerald-600' : v < 0 ? 'text-red-500' : 'text-gray-400')

const IST = 'Asia/Kolkata'
export const fmtTimeIST = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
export const fmtDateIST = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' })

/** Compact relative stamp for notification feeds ("2m ago", "5h ago", then a date). */
export const relTime = (iso: string) => {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days}d ago`
  return fmtDateIST(iso)
}
