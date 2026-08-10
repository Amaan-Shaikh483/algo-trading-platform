import { apiDelete, apiGet, apiPost } from './api'

/** Mirrors backend/src/services/brokerConnectionService.ts view models. */

export type ConnectionStatus = 'connected' | 'token_expired' | 'disconnected' | 'invalid_credentials'

export interface BrokerProfileView {
  clientCode?: string
  clientcode?: string // raw SmartAPI casing tolerated
  name?: string
  email?: string
  mobileno?: string
  mobile?: string
  exchanges?: string[]
  products?: string[]
}

export interface BrokerStatusView {
  configured: boolean
  connectionId: string | null
  broker: string
  status: ConnectionStatus | 'not_configured'
  clientCode: string | null
  tokenExpiry: string | null
  lastError: string | null
  brokerProfile: BrokerProfileView | null
}

export interface BrokerCredentialsForm {
  apiKey: string
  clientCode: string
  mpin: string
  totpSecret: string
}

export const brokerApi = {
  status: () => apiGet<BrokerStatusView>('/api/broker/status'),
  test: (form: BrokerCredentialsForm) => apiPost<{ profile: BrokerProfileView }>('/api/broker/test', form),
  connect: (form: BrokerCredentialsForm) =>
    apiPost<{ connectionId: string; status: ConnectionStatus; profile: BrokerProfileView }>('/api/broker/connect', form),
  reconnect: (mpin: string) => apiPost<{ status: ConnectionStatus }>('/api/broker/reconnect', { mpin }),
  disconnect: () => apiPost<{ status: ConnectionStatus }>('/api/broker/disconnect'),
  remove: () => apiDelete<{ status: 'not_configured' }>('/api/broker/'),
}

/** Normalizes profile fields regardless of mapped-vs-raw SmartAPI shape. */
export function readProfile(p: BrokerProfileView | null | undefined) {
  return {
    name: p?.name ?? '—',
    clientCode: p?.clientCode ?? p?.clientcode ?? '—',
    email: p?.email ?? null,
    mobile: p?.mobile ?? p?.mobileno ?? null,
    exchanges: Array.isArray(p?.exchanges) ? p!.exchanges! : [],
    products: Array.isArray(p?.products) ? p!.products! : [],
  }
}
