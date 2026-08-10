import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import InstrumentSearch from '../components/InstrumentSearch'
import { Alert, Card } from '../components/ui'
import { watchlistApi } from '../lib/watchlistApi'
import type { WatchlistItem } from '../lib/watchlistApi'

/**
 * Spec §3.3 watchlist: add/reorder/remove against the cached instruments
 * table. Live LTP + change% land with the market-feed engine (step 7).
 */
export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    watchlistApi
      .list()
      .then(setItems)
      .catch((err) => setError((err as Error).message))
  }, [])
  useEffect(load, [load])

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-gray-900">Watchlist</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Track symbols you're interested in. Live prices arrive with the market-feed engine (build step 7).
        </p>
      </div>

      <Card>
        <InstrumentSearch onSelect={(hit) => void run(() => watchlistApi.add(hit))} />
      </Card>

      {error && <Alert tone="red">{error}</Alert>}

      {!items ? (
        <Card>
          <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
        </Card>
      ) : items.length === 0 ? (
        <Card className="py-12 text-center text-sm text-gray-400">
          Your watchlist is empty — search above to add symbols.
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <Card key={item.id} className="flex items-center justify-between !p-4">
              <div className="flex items-center gap-4">
                <span className="w-5 text-center text-xs font-medium text-gray-300">{index + 1}</span>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{item.symbol}</p>
                  <p className="text-xs text-gray-400">token {item.token}</p>
                </div>
                <span className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">
                  {item.exchange}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  disabled={index === 0}
                  onClick={() => void run(() => watchlistApi.move(item.id, 'up'))}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30"
                  title="Move up"
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  disabled={index === items.length - 1}
                  onClick={() => void run(() => watchlistApi.move(item.id, 'down'))}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30"
                  title="Move down"
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  onClick={() => void run(() => watchlistApi.remove(item.id))}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                  title="Remove"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
