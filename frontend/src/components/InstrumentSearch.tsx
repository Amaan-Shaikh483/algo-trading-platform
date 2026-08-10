import { useEffect, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { searchInstruments } from '../lib/instrumentApi'
import type { InstrumentHit } from '../lib/instrumentApi'

/**
 * Search-as-you-type over the cached instruments table (spec 3.3) — debounced,
 * prefix-ranked, never touches the live broker API. Used by the strategy
 * builder and the watchlist.
 */
export default function InstrumentSearch({
  placeholder = 'Search instruments (e.g. SBIN, RELIANCE, NIFTY)…',
  exchange,
  onSelect,
}: {
  placeholder?: string
  exchange?: string
  onSelect: (hit: InstrumentHit) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<InstrumentHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const hits = await searchInstruments(query.trim(), exchange)
        setResults(hits)
        setOpen(true)
      } catch (err) {
        setError((err as Error).message)
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, exchange])

  const pick = (hit: InstrumentHit) => {
    onSelect(hit)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-gray-200 bg-gray-50/60 py-2.5 pl-10 pr-9 text-sm placeholder:text-gray-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        {loading && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
        {!loading && query && (
          <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={15} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-20 mt-1.5 max-h-72 w-full overflow-auto rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
          {error && <p className="px-4 py-3 text-sm text-red-600">{error}</p>}
          {!error && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-gray-400">
              No matches. (Is the instruments cache populated? Run instrument-sync.)
            </p>
          )}
          {results.map((hit) => (
            <button
              key={`${hit.exchange}:${hit.token}`}
              onClick={() => pick(hit)}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-brand-50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{hit.symbol}</p>
                {hit.name && <p className="truncate text-xs text-gray-400">{hit.name}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {hit.lotsize != null && hit.lotsize > 1 && (
                  <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
                    lot {hit.lotsize}
                  </span>
                )}
                <span className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">
                  {hit.exchange}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
