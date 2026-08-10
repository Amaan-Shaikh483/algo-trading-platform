import { getServiceClient } from '../supabase/client'
import { HttpError } from '../lib/httpError'
import type { WatchlistItemRow } from '../supabase/types'

/** Watchlist CRUD (spec 3.3). Live LTP streaming attaches in step 7. */

export async function listWatchlist(userId: string): Promise<WatchlistItemRow[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('watchlist_items')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
  if (error) throw new HttpError(500, `Failed to load watchlist: ${error.message}`)
  return data ?? []
}

export async function addWatchlistItem(
  userId: string,
  input: { symbol?: string; token?: string; exchange?: string },
): Promise<WatchlistItemRow> {
  if (!input.symbol?.trim() || !input.token?.trim() || !input.exchange?.trim()) {
    throw new HttpError(400, 'symbol, token and exchange are required', 'VALIDATION')
  }
  const supabase = getServiceClient()
  const { data: maxRow } = await supabase
    .from('watchlist_items')
    .select('sort_order')
    .eq('user_id', userId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data, error } = await supabase
    .from('watchlist_items')
    .insert({
      user_id: userId,
      symbol: input.symbol.trim(),
      token: input.token.trim(),
      exchange: input.exchange.trim(),
      sort_order: (maxRow?.sort_order ?? -1) + 1,
    })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'Already in your watchlist', 'DUPLICATE')
    throw new HttpError(500, `Failed to add to watchlist: ${error.message}`)
  }
  return data
}

export async function removeWatchlistItem(userId: string, id: string): Promise<void> {
  const supabase = getServiceClient()
  const { error } = await supabase.from('watchlist_items').delete().eq('id', id).eq('user_id', userId)
  if (error) throw new HttpError(500, `Failed to remove watchlist item: ${error.message}`)
}

/** Swap sort_order with the neighbor above/below (spec 3.3 reorder). */
export async function moveWatchlistItem(userId: string, id: string, direction: 'up' | 'down'): Promise<void> {
  const items = await listWatchlist(userId)
  const index = items.findIndex((i) => i.id === id)
  if (index === -1) throw new HttpError(404, 'Watchlist item not found', 'NOT_FOUND')
  const swapIndex = direction === 'up' ? index - 1 : index + 1
  if (swapIndex < 0 || swapIndex >= items.length) return

  const supabase = getServiceClient()
  const a = items[index]
  const b = items[swapIndex]
  const { error } = await supabase
    .from('watchlist_items')
    .upsert([
      { id: a.id, user_id: userId, symbol: a.symbol, token: a.token, exchange: a.exchange, sort_order: b.sort_order },
      { id: b.id, user_id: userId, symbol: b.symbol, token: b.token, exchange: b.exchange, sort_order: a.sort_order },
    ] as never)
  if (error) throw new HttpError(500, `Failed to reorder watchlist: ${error.message}`)
}
