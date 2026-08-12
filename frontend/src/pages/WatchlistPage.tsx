import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, CandlestickChart, Loader2, Trash2 } from 'lucide-react'
import InstrumentSearch from '../components/InstrumentSearch'
import TradingChart from '../components/TradingChart'
import { Alert } from '../components/ui'
import { ApiError } from '../lib/api'
import { brokerApi } from '../lib/brokerApi'
import type { BrokerStatusView } from '../lib/brokerApi'
import { CHART_INTERVALS, CHART_INTERVAL_LABELS, chartApi } from '../lib/chartApi'
import type { ChartInterval, ChartStyle, OhlcvBar } from '../lib/chartApi'
import { demoCandles } from '../lib/chartIndicators'
import { dashboardApi } from '../lib/dashboardApi'
import type { QuoteView } from '../lib/dashboardApi'
import { pct } from '../lib/format'
import { watchlistApi } from '../lib/watchlistApi'
import type { WatchlistItem } from '../lib/watchlistApi'

const quoteKey = (exchange: string, token: string) => `${exchange}:${token}`

function changeOf(q: QuoteView | undefined): { abs: number; pct: number } | null {
  if (!q || q.close == null || q.close === 0 || q.ltp == null) return null
  const abs = q.ltp - q.close
  return { abs, pct: (abs / q.close) * 100 }
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [quotes, setQuotes] = useState<Map<string, QuoteView>>(new Map())
  const [broker, setBroker] = useState<BrokerStatusView | null>(null)
  const [interval, setInterval_] = useState<ChartInterval>('5m')
  const [style, setStyle] = useState<ChartStyle>('candle')
  const [showVolume, setShowVolume] = useState(true)
  const [showEma, setShowEma] = useState(true)
  const [showBb, setShowBb] = useState(false)
  const [showRsi, setShowRsi] = useState(false)
  const [candles, setCandles] = useState<OhlcvBar[]>([])
  const [chartSource, setChartSource] = useState<'broker' | 'demo' | null>(null)
  const [chartLoading, setChartLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chartError, setChartError] = useState<string | null>(null)

  const selected = items?.find((i) => i.id === selectedId) ?? items?.[0] ?? null

  const loadList = useCallback(async () => {
    const list = await watchlistApi.list()
    setItems(list)
    setSelectedId((cur) => {
      if (cur && list.some((i) => i.id === cur)) return cur
      return list[0]?.id ?? null
    })
  }, [])

  useEffect(() => {
    void loadList().catch((err) => setError((err as Error).message))
    brokerApi
      .status()
      .then(setBroker)
      .catch(() => setBroker(null))
  }, [loadList])

  // Live LTP + prev-close for the change% column (15s, same cadence as the dashboard).
  useEffect(() => {
    if (!items || items.length === 0 || broker?.status !== 'connected') return
    const symbols = items.map((i) => ({ exchange: i.exchange, token: i.token }))
    const load = () =>
      dashboardApi
        .quotes(symbols, 'FULL')
        .then((qs) => setQuotes(new Map(qs.map((q) => [quoteKey(q.exchange, q.symboltoken), q]))))
        .catch(() => undefined)
    void load()
    const t = window.setInterval(load, 15_000)
    return () => window.clearInterval(t)
  }, [items, broker?.status])

  useEffect(() => {
    if (!selected) {
      setCandles([])
      setChartSource(null)
      return
    }
    let cancelled = false
    setChartLoading(true)
    setChartError(null)
    void chartApi
      .candles({ exchange: selected.exchange, token: selected.token, interval })
      .then((res) => {
        if (cancelled) return
        setCandles(res.candles)
        setChartSource('broker')
      })
      .catch((err) => {
        if (cancelled) return
        const e = err as ApiError
        setCandles(demoCandles(90, 22_400))
        setChartSource('demo')
        setChartError(
          e.code === 'BROKER_NOT_CONNECTED' || e.code === 'SESSION_EXPIRED'
            ? 'Broker not connected — showing a sample chart. Connect Angel One to load live candles.'
            : e.message,
        )
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected?.id, selected?.exchange, selected?.token, interval])

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      await loadList()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const selectedQuote = selected ? quotes.get(quoteKey(selected.exchange, selected.token)) : undefined
  const selectedChange = changeOf(selectedQuote)
  const lastClose = candles.length ? candles[candles.length - 1].close : null
  const headerLtp = selectedQuote?.ltp ?? lastClose

  const toggleCls = (on: boolean) =>
    `rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
      on ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
    }`

  const overlayHint = useMemo(() => {
    const bits = []
    if (showEma && style !== 'area') bits.push('EMA 9/21')
    if (showBb && style !== 'area') bits.push('Bollinger 20,2')
    if (showRsi) bits.push('RSI 14')
    if (showVolume) bits.push('Volume')
    return bits.join(' · ')
  }, [showEma, showBb, showRsi, showVolume, style])

  return (
    <div className="-mx-6 -my-6 flex h-[calc(100vh-4rem)] min-h-[560px] flex-col overflow-hidden bg-[#f4f6fb] lg:flex-row">
      {/* Watchlist rail */}
      <aside className="flex max-h-[42vh] w-full shrink-0 flex-col border-b border-gray-200/80 bg-white lg:max-h-none lg:w-[300px] lg:border-b-0 lg:border-r">
        <div className="border-b border-gray-100 px-4 py-3">
          <h1 className="font-display text-base font-semibold text-gray-900">Watchlist</h1>
          <p className="mt-0.5 text-xs text-gray-400">Click a symbol to load its chart</p>
          <div className="mt-3">
            <InstrumentSearch onSelect={(hit) => void run(() => watchlistApi.add(hit))} />
          </div>
        </div>

        {error && (
          <div className="px-4 pt-3">
            <Alert tone="red">{error}</Alert>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!items ? (
            <div className="flex justify-center py-10">
              <Loader2 className="animate-spin text-brand-600" size={22} />
            </div>
          ) : items.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-gray-400">Search above to add symbols.</p>
          ) : (
            items.map((item, index) => {
              const q = quotes.get(quoteKey(item.exchange, item.token))
              const ch = changeOf(q)
              const active = selected?.id === item.id
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(item.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setSelectedId(item.id)}
                  className={`flex cursor-pointer items-center gap-2 border-l-[3px] px-3 py-2.5 transition-colors ${
                    active ? 'border-brand-600 bg-brand-50/70' : 'border-transparent hover:bg-gray-50'
                  }`}
                >
                  <span className="w-4 text-center text-[11px] text-gray-300">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{item.symbol}</p>
                    <p className="text-[11px] text-gray-400">
                      {item.exchange}
                      {q?.tradingsymbol && q.tradingsymbol !== item.symbol ? ` · ${q.tradingsymbol}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-gray-900">
                      {q?.ltp != null ? q.ltp.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
                    </p>
                    <p className={`text-[11px] font-semibold tabular-nums ${ch == null ? 'text-gray-300' : ch.abs >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {ch == null ? '—' : `${ch.abs >= 0 ? '+' : ''}${pct(ch.pct)}`}
                    </p>
                  </div>
                  <div className="flex flex-col" onClick={(e) => e.stopPropagation()}>
                    <button
                      disabled={index === 0}
                      onClick={() => void run(() => watchlistApi.move(item.id, 'up'))}
                      className="rounded p-0.5 text-gray-300 hover:bg-gray-100 hover:text-gray-500 disabled:opacity-30"
                      title="Move up"
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      disabled={index === items.length - 1}
                      onClick={() => void run(() => watchlistApi.move(item.id, 'down'))}
                      className="rounded p-0.5 text-gray-300 hover:bg-gray-100 hover:text-gray-500 disabled:opacity-30"
                      title="Move down"
                    >
                      <ArrowDown size={12} />
                    </button>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void run(() => watchlistApi.remove(item.id))
                    }}
                    className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500"
                    title="Remove"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </aside>

      {/* Chart pane */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-gray-200/80 bg-white px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="font-display text-lg font-semibold text-gray-900">{selected?.symbol ?? 'No symbol'}</h2>
              {selected && <span className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{selected.exchange}</span>}
              {chartSource === 'demo' && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">Sample data</span>}
            </div>
            {selected && (
              <p className="mt-0.5 text-sm text-gray-500">
                {headerLtp != null ? (
                  <>
                    <span className="font-display text-base font-bold tabular-nums text-gray-900">
                      ₹{headerLtp.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </span>
                    {selectedChange && (
                      <span className={`ml-2 text-xs font-semibold ${selectedChange.abs >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {selectedChange.abs >= 0 ? '+' : ''}
                        {selectedChange.abs.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ({pct(selectedChange.pct)})
                      </span>
                    )}
                    <span className="ml-2 text-xs text-gray-400">
                      {CHART_INTERVAL_LABELS[interval]} · {overlayHint || 'Price'}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-gray-400">{chartLoading ? 'Loading candles…' : 'No quote yet'}</span>
                )}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {CHART_INTERVALS.map((tf) => (
              <button key={tf} type="button" onClick={() => setInterval_(tf)} className={toggleCls(interval === tf)}>
                {CHART_INTERVAL_LABELS[tf]}
              </button>
            ))}
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-100 bg-white px-4 py-2">
          {(['candle', 'bar', 'area'] as ChartStyle[]).map((s) => (
            <button key={s} type="button" onClick={() => setStyle(s)} className={toggleCls(style === s)}>
              {s === 'candle' ? 'Candles' : s === 'bar' ? 'Bars' : 'Area'}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-gray-200" />
          <button type="button" onClick={() => setShowVolume((v) => !v)} className={toggleCls(showVolume)}>
            Volume
          </button>
          <button type="button" onClick={() => setShowEma((v) => !v)} className={toggleCls(showEma)} disabled={style === 'area'}>
            EMA 9/21
          </button>
          <button type="button" onClick={() => setShowBb((v) => !v)} className={toggleCls(showBb)} disabled={style === 'area'}>
            Bollinger
          </button>
          <button type="button" onClick={() => setShowRsi((v) => !v)} className={toggleCls(showRsi)}>
            RSI
          </button>
        </div>

        {chartError && (
          <div className="px-4 pt-3">
            <Alert tone={chartSource === 'demo' ? 'yellow' : 'red'}>
              {chartError}{' '}
              {(chartError.includes('Broker') || chartError.includes('reconnect')) && (
                <Link to="/broker" className="font-semibold underline">
                  Open broker →
                </Link>
              )}
            </Alert>
          </div>
        )}

        <div className="relative min-h-0 flex-1 bg-white">
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-400">
              <CandlestickChart size={36} className="text-gray-300" />
              <p className="text-sm">Add a symbol to see its chart</p>
            </div>
          ) : chartLoading && candles.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="animate-spin text-brand-600" size={28} />
            </div>
          ) : (
            <TradingChart
              data={candles}
              style={style}
              showVolume={showVolume}
              showEma={showEma}
              showBb={showBb}
              showRsi={showRsi}
              lastPrice={chartSource === 'broker' ? (selectedQuote?.ltp ?? null) : null}
            />
          )}
        </div>
      </section>
    </div>
  )
}
