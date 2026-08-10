import { apiDelete, apiGet, apiPost, apiRequest } from './api'

export interface WatchlistItem {
  id: string
  user_id: string
  symbol: string
  token: string
  exchange: string
  sort_order: number
  created_at: string
}

const apiPatch = <T>(path: string, body?: unknown) => apiRequest<T>('PATCH', path, body ?? {})

export const watchlistApi = {
  list: () => apiGet<WatchlistItem[]>('/api/watchlist'),
  add: (item: { symbol: string; token: string; exchange: string }) => apiPost<WatchlistItem>('/api/watchlist', item),
  remove: (id: string) => apiDelete<{ ok: boolean }>(`/api/watchlist/${id}`),
  move: (id: string, direction: 'up' | 'down') => apiPatch<{ ok: boolean }>(`/api/watchlist/${id}/move`, { direction }),
}
