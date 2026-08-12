import { useEffect, useRef } from 'react'
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts'
import type { ChartStyle, OhlcvBar } from '../lib/chartApi'
import { calculateBollinger, calculateEMA, calculateRSI } from '../lib/chartIndicators'

const UP = '#0ca30c'
const DOWN = '#d03b3b'
const BRAND = '#2c54e8'

export interface TradingChartProps {
  data: OhlcvBar[]
  style?: ChartStyle
  showVolume?: boolean
  showEma?: boolean
  showBb?: boolean
  showRsi?: boolean
  lastPrice?: number | null
}

type CandleApi = ISeriesApi<'Candlestick'>
type BarApi = ISeriesApi<'Bar'>
type AreaApi = ISeriesApi<'Area'>
type LineApi = ISeriesApi<'Line'>
type HistApi = ISeriesApi<'Histogram'>

/**
 * TradingView Lightweight Charts v5 wrapper (candles + volume pane + overlays).
 * Recreates the chart when style / pane toggles change; live last-price ticks
 * go through series.update so we don't rebuild on every quote poll.
 */
export default function TradingChart({
  data,
  style = 'candle',
  showVolume = true,
  showEma = true,
  showBb = false,
  showRsi = false,
  lastPrice = null,
}: TradingChartProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const priceRef = useRef<CandleApi | BarApi | AreaApi | null>(null)
  const volumeRef = useRef<HistApi | null>(null)
  const ema9Ref = useRef<LineApi | null>(null)
  const ema21Ref = useRef<LineApi | null>(null)
  const rsiRef = useRef<LineApi | null>(null)
  const bbUpperRef = useRef<LineApi | null>(null)
  const bbMidRef = useRef<LineApi | null>(null)
  const bbLowerRef = useRef<LineApi | null>(null)
  const dataRef = useRef<OhlcvBar[]>([])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return

    const initialWidth = el.clientWidth || el.parentElement?.clientWidth || 800
    const initialHeight = el.clientHeight || el.parentElement?.clientHeight || 480

    const chart = createChart(el, {
      width: initialWidth,
      height: initialHeight,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#6b7280',
        fontSize: 12,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: {
        borderColor: '#e5e7eb',
        scaleMargins: { top: 0.08, bottom: showVolume || showRsi ? 0.04 : 0.08 },
      },
      timeScale: {
        borderColor: '#e5e7eb',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: false },
    })
    chartRef.current = chart

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0 && chartRef.current) {
          chartRef.current.applyOptions({ width, height })
        }
      }
    })
    ro.observe(el)

    let price: CandleApi | BarApi | AreaApi
    if (style === 'bar') {
      price = chart.addSeries(BarSeries, {
        upColor: UP,
        downColor: DOWN,
        thinBars: false,
        openVisible: true,
      })
    } else if (style === 'area') {
      price = chart.addSeries(AreaSeries, {
        lineColor: BRAND,
        topColor: 'rgba(44, 84, 232, 0.28)',
        bottomColor: 'rgba(44, 84, 232, 0.00)',
        lineWidth: 2,
      })
    } else {
      price = chart.addSeries(CandlestickSeries, {
        upColor: UP,
        downColor: DOWN,
        borderVisible: false,
        wickUpColor: UP,
        wickDownColor: DOWN,
      })
    }
    priceRef.current = price

    if (showEma && style !== 'area') {
      ema9Ref.current = chart.addSeries(LineSeries, {
        color: BRAND,
        lineWidth: 2,
        title: 'EMA 9',
        lastValueVisible: false,
        priceLineVisible: false,
      })
      ema21Ref.current = chart.addSeries(LineSeries, {
        color: '#f5a623',
        lineWidth: 2,
        title: 'EMA 21',
        lastValueVisible: false,
        priceLineVisible: false,
      })
    }

    if (showBb && style !== 'area') {
      bbUpperRef.current = chart.addSeries(LineSeries, { color: 'rgba(44, 84, 232, 0.7)', lineWidth: 1, title: 'BB Upper', lastValueVisible: false, priceLineVisible: false })
      bbMidRef.current = chart.addSeries(LineSeries, { color: 'rgba(44, 84, 232, 0.4)', lineWidth: 1, lineStyle: LineStyle.Dashed, title: 'BB Mid', lastValueVisible: false, priceLineVisible: false })
      bbLowerRef.current = chart.addSeries(LineSeries, { color: 'rgba(44, 84, 232, 0.7)', lineWidth: 1, title: 'BB Lower', lastValueVisible: false, priceLineVisible: false })
    }

    if (showVolume) {
      volumeRef.current = chart.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: 'volume' },
        },
        1,
      )
    }

    if (showRsi) {
      rsiRef.current = chart.addSeries(
        LineSeries,
        {
          color: '#9b59b6',
          lineWidth: 2,
          title: 'RSI 14',
        },
        showVolume ? 2 : 1,
      )
    }

    const apply = (bars: OhlcvBar[]) => {
      dataRef.current = bars
      if (bars.length === 0) return
      if (style === 'area') {
        ;(price as AreaApi).setData(bars.map((b) => ({ time: b.time, value: b.close })))
      } else {
        price.setData(bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })))
      }
      ema9Ref.current?.setData(calculateEMA(bars, 9))
      ema21Ref.current?.setData(calculateEMA(bars, 21))
      if (bbUpperRef.current && bbMidRef.current && bbLowerRef.current) {
        const bb = calculateBollinger(bars, 20, 2)
        bbUpperRef.current.setData(bb.upper)
        bbMidRef.current.setData(bb.middle)
        bbLowerRef.current.setData(bb.lower)
      }
      volumeRef.current?.setData(
        bars.map((b) => ({
          time: b.time,
          value: b.volume,
          color: b.close >= b.open ? 'rgba(12, 163, 12, 0.45)' : 'rgba(208, 59, 59, 0.45)',
        })),
      )
      rsiRef.current?.setData(calculateRSI(bars, 14))
      chart.timeScale().fitContent()
    }

    apply(data)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      priceRef.current = null
      volumeRef.current = null
      ema9Ref.current = null
      ema21Ref.current = null
      rsiRef.current = null
      bbUpperRef.current = null
      bbMidRef.current = null
      bbLowerRef.current = null
    }
    // Recreate when the series layout changes. Data updates after mount go through the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, showVolume, showEma, showBb, showRsi])

  useEffect(() => {
    const series = priceRef.current
    const chart = chartRef.current
    if (!series || !chart) return
    dataRef.current = data
    if (data.length === 0) {
      series.setData([])
      volumeRef.current?.setData([])
      ema9Ref.current?.setData([])
      ema21Ref.current?.setData([])
      rsiRef.current?.setData([])
      bbUpperRef.current?.setData([])
      bbMidRef.current?.setData([])
      bbLowerRef.current?.setData([])
      return
    }
    if (style === 'area') {
      ;(series as AreaApi).setData(data.map((b) => ({ time: b.time, value: b.close })))
    } else {
      series.setData(data.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })))
    }
    ema9Ref.current?.setData(calculateEMA(data, 9))
    ema21Ref.current?.setData(calculateEMA(data, 21))
    volumeRef.current?.setData(
      data.map((b) => ({
        time: b.time,
        value: b.volume,
        color: b.close >= b.open ? 'rgba(12, 163, 12, 0.45)' : 'rgba(208, 59, 59, 0.45)',
      })),
    )
    rsiRef.current?.setData(calculateRSI(data, 14))
    if (bbUpperRef.current && bbMidRef.current && bbLowerRef.current) {
      const bb = calculateBollinger(data, 20, 2)
      bbUpperRef.current.setData(bb.upper)
      bbMidRef.current.setData(bb.middle)
      bbLowerRef.current.setData(bb.lower)
    }
    chart.timeScale().fitContent()
  }, [data, style])

  // Live LTP: mutate the last bar in place (same timestamp → series.update replaces).
  useEffect(() => {
    if (lastPrice == null || !Number.isFinite(lastPrice)) return
    const series = priceRef.current
    const bars = dataRef.current
    if (!series || bars.length === 0) return
    const last = bars[bars.length - 1]
    const next = {
      time: last.time as Time,
      open: last.open,
      high: Math.max(last.high, lastPrice),
      low: Math.min(last.low, lastPrice),
      close: lastPrice,
    }
    if (style === 'area') {
      ;(series as AreaApi).update({ time: next.time, value: lastPrice })
    } else {
      series.update(next)
    }
    volumeRef.current?.update({
      time: last.time,
      value: last.volume,
      color: lastPrice >= last.open ? 'rgba(12, 163, 12, 0.45)' : 'rgba(208, 59, 59, 0.45)',
    })
  }, [lastPrice, style])

  return (
    <div
      ref={hostRef}
      className="w-full flex-1 min-h-[360px]"
      style={{ minHeight: '360px', height: '100%', width: '100%', position: 'relative' }}
    />
  )
}
