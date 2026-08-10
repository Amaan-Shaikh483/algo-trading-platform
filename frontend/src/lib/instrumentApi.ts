import { apiGet } from './api'

/** Mirrors backend instrumentService.InstrumentHit. */
export interface InstrumentHit {
  token: string
  symbol: string
  name: string | null
  exchange: string
  segment: string
  lotsize: number | null
  tick_size: number | null
  expiry: string | null
  strike: number | null
}

export function searchInstruments(q: string, exchange?: string): Promise<InstrumentHit[]> {
  const params = new URLSearchParams({ q })
  if (exchange) params.set('exchange', exchange)
  return apiGet<InstrumentHit[]>(`/api/instruments/search?${params.toString()}`)
}
