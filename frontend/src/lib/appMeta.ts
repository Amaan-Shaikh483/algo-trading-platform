import { brokerApi } from './brokerApi'
import type { BrokerStatusView } from './brokerApi'
import { riskApi } from './riskApi'
import type { RiskCounter, RiskSettings } from './riskApi'

/**
 * Shared read-model cache for the two resources EVERY chrome widget wants
 * (Layout sidebar dot, header kill switch, onboarding wizard, dashboard
 * health chip + risk widget): broker connection status and risk settings.
 *
 * Single-flight + short TTL:
 *  - concurrent callers (incl. React StrictMode's dev double-mount) share ONE
 *    in-flight request — no duplicate network chatter on page entry;
 *  - repeat reads within `ttlMs` reuse the resolved value;
 *  - mutations (broker connect/disconnect, risk save/kill-switch/unblock)
 *    invalidate explicitly so the next read refetches.
 * Cleared on sign-out / account switch (authStore calls invalidateAll) so no
 * cross-user bleed in the same tab.
 */

export interface RiskView {
  settings: RiskSettings | null
  today: RiskCounter | null
  tradingDate: string
}

interface Entry<T> {
  inflight: Promise<T> | null
  hasValue: boolean
  value: T | undefined
  at: number
}

function makeEntry<T>(ttlMs: number, fetcher: () => Promise<T>) {
  const e: Entry<T> = { inflight: null, hasValue: false, value: undefined, at: 0 }
  return {
    get(force = false): Promise<T> {
      if (force) e.hasValue = false
      if (e.hasValue && Date.now() - e.at < ttlMs) return Promise.resolve(e.value as T)
      if (e.inflight) return e.inflight
      e.inflight = fetcher()
        .then((v) => {
          e.value = v
          e.hasValue = true
          e.at = Date.now()
          e.inflight = null
          return v
        })
        .catch((err) => {
          e.inflight = null // never cache failures
          throw err
        })
      return e.inflight
    },
    invalidate(): void {
      e.hasValue = false
    },
  }
}

const TTL_MS = 5_000
const broker = makeEntry<BrokerStatusView>(TTL_MS, () => brokerApi.status())
const risk = makeEntry<RiskView>(TTL_MS, () => riskApi.get())

export const appMeta = {
  brokerStatus: (force = false) => broker.get(force),
  risk: (force = false) => risk.get(force),
  invalidateBroker: () => broker.invalidate(),
  invalidateRisk: () => risk.invalidate(),
  invalidateAll: () => {
    broker.invalidate()
    risk.invalidate()
  },
}
