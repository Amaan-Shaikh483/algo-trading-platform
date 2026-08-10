/**
 * Seed sample strategies into a user's account (learning aid).
 *
 * Usage (from repo root):
 *   npm run seed:samples -w backend -- <login-email>
 *
 * Creates up to 3 ready-to-backtest strategies (paper mode, inactive — they
 * never trade live on their own). Quantities are sized so a ₹1,00,000 demo
 * capital never trips the capital-allocation gate (the "signals skipped" trap).
 * Idempotent: re-running skips names that already exist for that user.
 *
 * NOTE (honest design): these are EDUCATIONAL examples with rules that fire
 * regularly on liquid large-caps. Profit is never guaranteed — markets decide;
 * the point is to see real trades/statistics flow through the backtester.
 */
import { getServiceClient } from './supabase/client'
import { validateStrategyRules } from '@algo/rule-schema'
import type { Condition, StrategyRules } from '@algo/rule-schema'
import { RULE_SCHEMA_VERSION } from '@algo/rule-schema'

const email = process.argv[2]
if (!email) {
  console.error('Usage: npm run seed:samples -w backend -- <login-email>')
  process.exit(1)
}

const ind = (indicator: 'ema' | 'rsi', params: Record<string, number>) =>
  ({ kind: 'indicator', indicator, params, output: 'value' }) as const
const val = (value: number) => ({ kind: 'value', value }) as const
let cid = 0
const cond = (left: Condition['left'], operator: Condition['operator'], right: Condition['right']): Condition => ({
  id: `seed_${++cid}`,
  left,
  operator,
  right,
})

function rules(partial: {
  entryConditions: Condition[]
  quantity: number
  maxTradesPerDay: number
  slPercent: number
  rr: number
  trailingPercent?: number
  squareOff?: string
}): StrategyRules {
  return {
    version: RULE_SCHEMA_VERSION,
    direction: { side: 'long' },
    entry: { orderType: 'MARKET', productType: 'INTRADAY' },
    entryConditions: { combinator: 'and', conditions: partial.entryConditions },
    exit: {
      stopLoss: { type: 'percent', value: partial.slPercent },
      target: { type: 'rr_multiple', value: partial.rr },
      ...(partial.trailingPercent ? { trailingStopLoss: { type: 'percent' as const, value: partial.trailingPercent } } : {}),
      timeSquareOff: { time: partial.squareOff ?? '15:15' },
    },
    risk: { quantity: partial.quantity, maxConcurrentPositions: 1, maxTradesPerDay: partial.maxTradesPerDay },
  }
}

interface SampleSpec {
  name: string
  description: string
  instrumentQuery: { symbol: string; exchange: string } // exact symbol in instruments cache
  timeframe: string
  rules: StrategyRules
}

const SAMPLES: SampleSpec[] = [
  {
    name: 'Sample · RELIANCE EMA 9/21 Cross (15m)',
    description: 'Educational sample — EMA 9/21 crossover on 15m, 0.4% SL, 2R target, 2 trades/day. No profit guarantee; use it to explore the backtester.',
    instrumentQuery: { symbol: 'RELIANCE-EQ', exchange: 'NSE' },
    timeframe: '15m',
    rules: rules({
      entryConditions: [cond(ind('ema', { period: 9 }), 'crosses_above', ind('ema', { period: 21 }))],
      quantity: 30, // ~₹42k notional at ~₹1,400 — fits ₹1L capital
      maxTradesPerDay: 2,
      slPercent: 0.4,
      rr: 2,
      trailingPercent: 0.4,
    }),
  },
  {
    name: 'Sample · SBIN RSI-40 Momentum (15m)',
    description: 'Educational sample — RSI(14) turning up through 40 after a dip, 0.5% SL, 2R target with 0.5% trail, 3 trades/day.',
    instrumentQuery: { symbol: 'SBIN-EQ', exchange: 'NSE' },
    timeframe: '15m',
    rules: rules({
      entryConditions: [cond(ind('rsi', { period: 14 }), 'crosses_above', val(40))],
      quantity: 50, // ~₹40k notional at ~₹800
      maxTradesPerDay: 3,
      slPercent: 0.5,
      rr: 2,
      trailingPercent: 0.5,
    }),
  },
  {
    name: 'Sample · NIFTY 50 Index EMA 20/50 (5m) — backtest study',
    description: 'Backtest-study sample on the NIFTY 50 INDEX (not tradable live — trade the NIFTY future for live). EMA 20/50 cross on 5m, qty 1 keeps notional at ~₹25k.',
    instrumentQuery: { symbol: 'Nifty 50', exchange: 'NSE' },
    timeframe: '5m',
    rules: rules({
      entryConditions: [cond(ind('ema', { period: 20 }), 'crosses_above', ind('ema', { period: 50 }))],
      quantity: 1, // index points ~₹25k notional per 1 unit
      maxTradesPerDay: 2,
      slPercent: 0.35,
      rr: 2,
      trailingPercent: 0.35,
    }),
  },
]

async function main(): Promise<void> {
  const supabase = getServiceClient()

  // ── Find the user by email (auth admin) ──
  const { data: users, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 500 })
  if (listErr) throw new Error(`auth admin listUsers failed: ${listErr.message}`)
  const user = users.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!user) throw new Error(`No auth user with email '${email}'. Log in to the app once first, then re-run.`)

  console.log(`Seeding samples for ${email} (${user.id})\n`)

  for (const sample of SAMPLES) {
    // idempotency: skip if this user already has a strategy with the same name
    const { data: existing } = await supabase
      .from('strategies')
      .select('id')
      .eq('user_id', user.id)
      .eq('name', sample.name)
      .maybeSingle()
    if (existing) {
      console.log(`SKIP  '${sample.name}' — already exists (${existing.id})`)
      continue
    }

    // resolve instrument from the cache
    const { data: inst } = await supabase
      .from('instruments')
      .select('token,symbol,segment,instrumenttype')
      .eq('exchange', sample.instrumentQuery.exchange)
      .eq('symbol', sample.instrumentQuery.symbol)
      .limit(1)
      .maybeSingle()
    if (!inst) {
      console.log(`SKIP  '${sample.name}' — instrument '${sample.instrumentQuery.symbol}' not in cache (run instrument-sync first, then retry)`)
      continue
    }

    const check = validateStrategyRules(sample.rules)
    if (!check.valid) {
      console.log(`SKIP  '${sample.name}' — rules failed validation: ${check.errors.join('; ')}`)
      continue
    }

    const { data, error } = await supabase
      .from('strategies')
      .insert({
        user_id: user.id,
        name: sample.name,
        description: sample.description,
        instrument: inst.symbol,
        symbol_token: inst.token,
        exchange: sample.instrumentQuery.exchange,
        segment: inst.segment,
        timeframe: sample.timeframe,
        rules: sample.rules,
        risk_settings: {},
        mode: 'paper',
        is_active: false,
      } as never)
      .select('id')
      .single()
    if (error) {
      console.log(`FAIL  '${sample.name}' — insert error: ${error.message}`)
      continue
    }
    console.log(`OK    '${sample.name}'  →  ${data.id}`)
  }

  console.log(`
Done. Next steps in the app:
  1. Strategies page — the new cards appear (mode: paper, inactive).
  2. Backtesting — pick a sample, range 3M, capital ₹1,00,000 → Run backtest.
  3. Watch trades/statistics/heatmaps fill up. Then tweak rules in the Builder.
Reminder: samples are educational; paper mode only until YOU flip mode deliberately.`)
}

main().catch((err) => {
  console.error('seed failed:', (err as Error).message)
  process.exit(1)
})
