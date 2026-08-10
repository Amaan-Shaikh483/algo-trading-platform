/**
 * Strategy signal diagnostic CLI — WHY didn't my backtest produce trades?
 *
 * Usage (from repo root):
 *   npm run diagnose -w backend -- <strategyId-or-name> [from YYYY-MM-DD] [to YYYY-MM-DD]
 *
 * What it does (offline of the engine, same code paths the engine uses):
 *   1. Loads the strategy + prints its rules in human form.
 *   2. Fetches the same historical candles the backtest would.
 *   3. Replays every closed bar through IndicatorRuntime + evaluateEntrySignal
 *      (the exact functions runBacktestCore calls) and reports:
 *        - every bar the FULL entry rule fired, plus which risk gate would
 *          have blocked it (square-off cutoff / daily cap / capital cap);
 *        - per-condition pass counts and the bars where each condition came
 *          CLOSEST to firing ("near misses" — how far the EMAs were apart);
 *        - the real engine result (trades + skipped signals) as ground truth.
 *   4. Prints targeted hints based on what blocked the signals.
 *
 * Exits non-zero if the strategy/candles can't be loaded. Read-only — it
 * places nothing and changes nothing.
 */
import { getServiceClient } from './supabase/client'
import { fetchHistoricalCandles } from './services/backtestService'
import { runBacktestCore } from './services/engine/backtestEngine'
import { IndicatorRuntime, collectIndicatorSpecs, hhmmToMinutes, istDayKey, istMinutesOfDay } from './services/engine/indicatorEngine'
import { evaluateCondition, evaluateEntrySignal } from './services/engine/ruleEvaluator'
import { summarizeRules } from '@algo/rule-schema'
import type { Condition, Operand, StrategyRules } from '@algo/rule-schema'
import type { Candle } from './services/brokers/types'

// ── CLI args ────────────────────────────────────────────────────────────────
const [strategyRef, fromArg, toArg] = process.argv.slice(2)
if (!strategyRef) {
  console.error('Usage: npm run diagnose -w backend -- <strategyId-or-name> [from YYYY-MM-DD] [to YYYY-MM-DD]')
  process.exit(1)
}
const to = toArg ? new Date(`${toArg}T23:59:59+05:30`) : new Date()
const from = fromArg ? new Date(`${fromArg}T00:00:00+05:30`) : new Date(to.getTime() - 30 * 86400000)

const istTs = (d: Date) =>
  d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
const inr2 = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
const capitalizeArr = <T>(arr: T[], n: number) => arr.slice(0, n)

const opLabel = (op: Operand): string => {
  if (op.kind === 'value') return String(op.value)
  if (op.kind === 'price') return op.field
  const params = Object.values(op.params).join(',')
  return `${op.indicator.toUpperCase()}(${params}).${op.output}`
}

async function main(): Promise<void> {
  const supabase = getServiceClient()

  // ── 1. Load strategy (by id, else by case-insensitive name match) ──
  let strategy: Record<string, unknown> | null = null
  if (/^[0-9a-f-]{36}$/i.test(strategyRef)) {
    const { data } = await supabase.from('strategies').select('*').eq('id', strategyRef).maybeSingle()
    strategy = data
  } else {
    const { data } = await supabase.from('strategies').select('*').ilike('name', `%${strategyRef}%`).limit(5)
    if (data && data.length > 1) {
      console.error(`Multiple strategies match '${strategyRef}':\n${data.map((s) => `  ${(s as { id: string }).id}  ${(s as { name: string }).name}`).join('\n')}\nPass the full id instead.`)
      process.exit(1)
    }
    strategy = data?.[0] ?? null
  }
  if (!strategy) {
    console.error(`Strategy '${strategyRef}' not found.`)
    process.exit(1)
  }
  const rules = strategy.rules as StrategyRules

  console.log('━'.repeat(72))
  console.log(`STRATEGY  ${strategy.name}  ·  ${strategy.instrument} ${strategy.timeframe}  ·  ${strategy.exchange}`)
  console.log(`Direction ${rules.direction.side}  ·  Qty ${rules.risk.quantity}  ·  Max trades/day ${rules.risk.maxTradesPerDay}` +
    (rules.risk.capitalAllocationPercent != null ? `  ·  Capital cap ${rules.risk.capitalAllocationPercent}%` : '') +
    (rules.exit.timeSquareOff ? `  ·  Square-off ${rules.exit.timeSquareOff.time}` : ''))
  for (const line of summarizeRules(rules)) console.log(`  ${line}`)
  console.log('━'.repeat(72))

  // Instrument row → index/tradability note
  const { data: inst } = await supabase
    .from('instruments')
    .select('instrumenttype,segment,lotsize,symbol,name')
    .eq('exchange', strategy.exchange as string)
    .eq('token', strategy.symbol_token as string)
    .maybeSingle()
  if (inst) {
    const idx = (inst.instrumenttype ?? '').startsWith('AMXIDX')
    console.log(`INSTRUMENT ${inst.symbol} · segment ${inst.segment} · type ${inst.instrumenttype ?? '—'} · lotsize ${inst.lotsize ?? '—'}`)
    if (idx) console.log('  ⚠ This is an INDEX — not directly tradable. Live mode cannot buy/sell it; trade the NIFTY future (NFO) instead. Backtest signals still compute fine.')
  } else {
    console.log('  ⚠ Instrument not found in the instruments cache (token may be stale after an expiry rollover) — candle fetch may still work.')
  }

  // ── 2. Fetch candles (same path as the backtest) ──
  console.log(`\nFetching candles ${istTs(from)} → ${istTs(to)} …`)
  const candles = await fetchHistoricalCandles(strategy.user_id as string, {
    exchange: strategy.exchange as string,
    symboltoken: strategy.symbol_token as string,
    interval: strategy.timeframe as string,
    from,
    to,
  })
  if (candles.length === 0) {
    console.error('No candles returned — check date range / token / broker session.')
    process.exit(1)
  }
  console.log(`DATA  ${candles.length} candles · first ${istTs(candles[0].time)} · last ${istTs(candles[candles.length - 1].time)}`)

  // ── 3. Entry-signal replay ──
  const runtime = new IndicatorRuntime(collectIndicatorSpecs(rules))
  const timeSqMinutes = rules.exit.timeSquareOff ? hhmmToMinutes(rules.exit.timeSquareOff.time) : null
  const entryTrue: { candle: Candle; gates: string[] }[] = []
  const condStats = rules.entryConditions.conditions.map(() => ({
    passed: 0,
    near: [] as { gapPct: number; candle: Candle; left: number; right: number }[],
  }))
  const tradesPerDay = new Map<string, number>()
  let prev: Candle | undefined
  let warmupBars = 0
  let warmupDone = false

  for (const candle of candles) {
    runtime.update(candle)
    const frame = { current: candle, previous: prev, runtime }
    // warmup = until every condition yields finite operands
    const verdicts = rules.entryConditions.conditions.map((c: Condition, ci: number) => {
      const v = evaluateCondition(c, frame)
      const st = condStats[ci]
      if (v.passed) st.passed++
      else if (Number.isFinite(v.left) && Number.isFinite(v.right)) {
        const gapPct = (Math.abs(v.left - v.right) / Math.max(Math.abs(v.left), Math.abs(v.right), 1)) * 100
        st.near.push({ gapPct, candle, left: v.left, right: v.right })
        st.near.sort((a, b) => a.gapPct - b.gapPct)
        if (st.near.length > 6) st.near.pop()
      }
      return v
    })
    if (!warmupDone) {
      warmupBars++
      if (verdicts.every((v) => Number.isFinite(v.left) && Number.isFinite(v.right))) warmupDone = true
    }
    if (evaluateEntrySignal(rules, frame)) {
      const dayKey = istDayKey(candle.time)
      const tradesToday = tradesPerDay.get(dayKey) ?? 0
      const gates: string[] = []
      if (timeSqMinutes != null && istMinutesOfDay(candle.time) >= timeSqMinutes) gates.push(`after ${rules.exit.timeSquareOff!.time} square-off cutoff`)
      if (tradesToday >= rules.risk.maxTradesPerDay) gates.push(`daily cap (${rules.risk.maxTradesPerDay}/day) already hit`)
      if (rules.risk.capitalAllocationPercent != null) {
        // engine compares against its LIVE capital; here we flag it as "depends"
        const notional = candle.close * rules.risk.quantity
        gates.push(`capital cap check: notional ₹${inr2(notional)} must be ≤ ${rules.risk.capitalAllocationPercent}% of engine capital`)
      }
      entryTrue.push({ candle, gates: gates.filter((g) => !g.startsWith('capital cap check')) })
      if (gates.length === 0) tradesPerDay.set(dayKey, tradesToday + 1)
    }
    prev = candle
  }

  console.log('━'.repeat(72))
  console.log(`ENTRY RULE EVALUATION  (${warmupBars} warmup bars skipped · ${candles.length} bars total)`)
  rules.entryConditions.conditions.forEach((c: Condition, ci: number) => {
    const st = condStats[ci]
    console.log(`  [${ci + 1}] ${opLabel(c.left)} ${c.operator} ${opLabel(c.right)}  →  true on ${st.passed} bars`)
  })
  console.log(`  FULL entry signal (${rules.entryConditions.combinator.toUpperCase()}) fired on ${entryTrue.length} bar(s)`)

  if (entryTrue.length > 0) {
    console.log('\nSignal bars:')
    for (const s of capitalizeArr(entryTrue, 12)) {
      console.log(`  ${istTs(s.candle.time)}  close ₹${inr2(s.candle.close)}${s.gates.length ? `  · BLOCKED BY: ${s.gates.join(' + ')}` : '  · would OPEN (engine state permitting)'}`)
    }
    if (entryTrue.length > 12) console.log(`  …and ${entryTrue.length - 12} more`)
  }

  console.log('\nNear misses (bars where each condition came closest to firing):')
  rules.entryConditions.conditions.forEach((c: Condition, ci: number) => {
    const st = condStats[ci]
    if (st.passed > 0) return
    console.log(`  [${ci + 1}] ${opLabel(c.left)} ${c.operator} ${opLabel(c.right)}`)
    for (const n of capitalizeArr(st.near, 3)) {
      console.log(`     ${istTs(n.candle.time)}  left=${inr2(n.left)}  right=${inr2(n.right)}  gap ${n.gapPct.toFixed(2)}%`)
    }
  })

  // ── 4. Ground truth: run the real engine on the same candles ──
  const result = runBacktestCore({
    rules,
    candles,
    config: { initialCapital: 100_000, brokerageType: 'flat', brokerageValue: 20, slippagePercent: 0.05 },
  })
  console.log('━'.repeat(72))
  console.log(`ENGINE GROUND TRUTH  trades=${result.summary.totalTrades}  skippedSignals=${result.summary.skippedSignals}  netPnl=₹${inr2(result.summary.totalNetPnl)}`)

  // ── 5. Hints ──
  console.log('\nHINTS:')
  if (entryTrue.length === 0) {
    console.log('  • The entry rule NEVER fired on this data — gates/capital are not the issue; the CONDITIONS are.')
    const minGap = Math.min(...condStats.flatMap((s) => s.near.map((n) => n.gapPct)))
    if (Number.isFinite(minGap) && minGap < 1) {
      console.log(`  • Closest approach was ${minGap.toFixed(2)}% — the rule nearly fired. Loosen it: shorter/slower EMA periods, or try operator '>' instead of 'crosses_above'.`)
    } else if (Number.isFinite(minGap)) {
      console.log(`  • Closest approach was ${minGap.toFixed(2)}% — conditions are far from this market/timeframe. Change indicator periods or pick a different symbol/timeframe.`)
    }
    console.log('  • Try a longer range (3M/6M) — EMA crossovers are rare; a single month can easily contain none.')
  } else {
    const blocked = entryTrue.filter((s) => s.gates.length > 0).length
    const openable = entryTrue.length - blocked
    console.log(`  • Signals DO fire (${entryTrue.length} bars). Openable by gates: ${openable}, blocked: ${blocked}.`)
    if (blocked > 0) console.log('  • Widen the trading window / raise max trades per day / move square-off later in the builder.')
    if (result.summary.skippedSignals > 0) console.log(`  • Engine skipped ${result.summary.skippedSignals} signals — capital-allocation cap too tight for ₹100k demo capital? Raise capital or the cap %.`)
  }
  console.log('')
}

main().catch((err) => {
  console.error('diagnose failed:', (err as Error).message)
  process.exit(1)
})
