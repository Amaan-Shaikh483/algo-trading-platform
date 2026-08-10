import { getServiceClient } from '../../supabase/client'
import { logger } from '../../lib/logger'
import { auditLog, notify } from '../userEvents'
import { recordClosedTrade, riskTradingDate, supabaseRiskStore } from './riskManager'
import { getSessionAdapterForUser } from '../brokerConnectionService'
import * as ledger from '../live/executionLedger'
import { executeIntent } from '../live/orderRouter'

/**
 * §3.7 Kill switch — "Stop All & Square Off".
 *
 * executeKillSwitch:
 *   1. kill_switch_active = true         → risk gate blocks every new entry
 *   2. deactivate ALL active strategies  → runtimes stop evaluating
 *   3. square off every open position    → exits STILL pass through the risk
 *      manager (purpose 'exit' is never blocked — the gate records the audit
 *      trail; blocking an exit would increase risk)
 *   4. notification + audit trail
 *
 * The live worker independently re-sweeps every 15s while the switch is on, so
 * positions whose square-off failed here are retried until flat.
 */

export interface KillSwitchSummary {
  strategiesDeactivated: number
  liveSquareOffs: { ok: number; failed: string[] }
  paperPositionsClosed: number
}

export async function executeKillSwitch(userId: string): Promise<KillSwitchSummary> {
  const supabase = getServiceClient()
  const summary: KillSwitchSummary = { strategiesDeactivated: 0, liveSquareOffs: { ok: 0, failed: [] }, paperPositionsClosed: 0 }

  // 1. Flip the switch.
  const { error: ksError } = await supabase
    .from('user_risk_settings')
    .upsert({ user_id: userId, kill_switch_active: true } as never, { onConflict: 'user_id' })
  if (ksError) throw new Error(`kill switch flip failed: ${ksError.message}`)

  // 2. Deactivate all active strategies (live AND paper — a panic stop halts
  //    the whole account; live-only auto-pause is the daily-loss path's job).
  const { data: deactivated, error: stratError } = await supabase
    .from('strategies')
    .update({ is_active: false } as never)
    .eq('user_id', userId)
    .eq('is_active', true)
    .select('id')
  if (stratError) throw new Error(`strategy deactivation failed: ${stratError.message}`)
  summary.strategiesDeactivated = deactivated?.length ?? 0

  // 3. Square off open positions.
  const openPositions = await ledger.getOpenPositions(userId)
  const livePositions = openPositions.filter((p) => p.mode === 'live')
  const paperPositions = openPositions.filter((p) => p.mode === 'paper')

  let liveAdapter
  if (livePositions.length > 0 || paperPositions.length > 0) {
    try {
      liveAdapter = (await getSessionAdapterForUser(userId)).adapter
    } catch (err) {
      logger.warn('kill switch: no broker session for square-off', { userId, error: (err as Error).message })
      for (const p of livePositions) summary.liveSquareOffs.failed.push(`${p.symbol}: no broker session`)
    }
  }

  for (const p of livePositions) {
    try {
      const side: 'BUY' | 'SELL' = p.side === 'LONG' ? 'SELL' : 'BUY'
      const outcome = await executeIntent({
        userId,
        strategyId: p.strategy_id ?? '',
        strategyName: 'kill-switch',
        symbol: p.symbol,
        symbolToken: p.symbol_token,
        exchange: p.exchange ?? 'NSE',
        side,
        quantity: p.quantity,
        approxPrice: Number(p.average_entry_price), // MARKET order — price is for the ledger ref only
        mode: 'live',
        purpose: 'exit',
        orderType: 'MARKET',
        productType: 'INTRADAY',
        clientRef: `${p.id}:kill:${riskTradingDate()}`,
        liveAdapter,
        exitReason: 'kill_switch',
      })
      if (outcome.outcome === 'rejected' || outcome.outcome === 'blocked' || outcome.outcome === 'failed') {
        summary.liveSquareOffs.failed.push(`${p.symbol}: ${outcome.reason ?? outcome.outcome}`)
        continue
      }
      // 'filled' or 'placed' (broker accepted; reconciliation will book it) —
      // close our side immediately only when the fill is confirmed.
      if (outcome.outcome === 'filled') {
        const exitPrice = outcome.fillPrice ?? Number(p.average_entry_price)
        await ledger.closePosition(p.id, { exitPrice, reason: 'kill_switch' })
        const pnl = (p.side === 'LONG' ? exitPrice - Number(p.average_entry_price) : Number(p.average_entry_price) - exitPrice) * p.quantity
        await ledger.insertTradeLog({
          userId,
          strategyId: p.strategy_id ?? '',
          symbol: p.symbol,
          side: p.side,
          quantity: p.quantity,
          entryPrice: Number(p.average_entry_price),
          exitPrice,
          pnl: Math.round(pnl * 100) / 100,
          mode: 'live',
          entryTime: p.opened_at,
          exitTime: new Date().toISOString(),
        })
        await recordClosedTrade(userId, Math.round(pnl * 100) / 100)
      }
      summary.liveSquareOffs.ok++
    } catch (err) {
      summary.liveSquareOffs.failed.push(`${p.symbol}: ${(err as Error).message}`)
    }
  }

  // Paper positions: square off at REST LTP (no broker order needed).
  for (const p of paperPositions) {
    try {
      let exitPrice = Number(p.average_entry_price)
      if (liveAdapter) {
        const quotes = await liveAdapter.getLTP({ [(p.exchange ?? 'NSE') as string]: [p.symbol_token] })
        const q = quotes.find((x) => x.symboltoken === p.symbol_token)
        if (q && q.ltp > 0) exitPrice = q.ltp
      }
      await ledger.closePosition(p.id, { exitPrice, reason: 'kill_switch' })
      const pnl = (p.side === 'LONG' ? exitPrice - Number(p.average_entry_price) : Number(p.average_entry_price) - exitPrice) * p.quantity
      await ledger.insertTradeLog({
        userId,
        strategyId: p.strategy_id ?? '',
        symbol: p.symbol,
        side: p.side,
        quantity: p.quantity,
        entryPrice: Number(p.average_entry_price),
        exitPrice,
        pnl: Math.round(pnl * 100) / 100,
        mode: 'paper',
        entryTime: p.opened_at,
        exitTime: new Date().toISOString(),
      })
      await ledger.openOrderIdempotent({
        userId,
        strategyId: p.strategy_id ?? '',
        clientRef: `${p.id}:kill:${riskTradingDate()}`,
        purpose: 'exit',
        mode: 'paper',
        symbol: p.symbol,
        symbolToken: p.symbol_token,
        exchange: p.exchange ?? 'NSE',
        transactionType: p.side === 'LONG' ? 'SELL' : 'BUY',
        orderType: 'MARKET',
        productType: 'INTRADAY',
        quantity: p.quantity,
        price: exitPrice,
      }).then(({ row }) => ledger.markOrderComplete(row.id, { averagePrice: exitPrice, filledQuantity: p.quantity }))
      summary.paperPositionsClosed++
    } catch (err) {
      summary.liveSquareOffs.failed.push(`${p.symbol} (paper): ${(err as Error).message}`)
    }
  }

  await notify(
    userId,
    'kill_switch',
    'Kill switch activated — Stop All & Square Off',
    `${summary.strategiesDeactivated} strategies deactivated · ${summary.liveSquareOffs.ok + summary.paperPositionsClosed} positions squared off` +
      (summary.liveSquareOffs.failed.length ? ` · ${summary.liveSquareOffs.failed.length} FAILED (worker keeps retrying)` : ''),
  )
  await auditLog(userId, 'risk.kill_switch', summary as never)
  logger.warn('kill switch executed', { userId, ...summary })
  return summary
}

/** Manual release: clears the switch; strategies stay paused until the user re-activates them. */
export async function releaseKillSwitch(userId: string): Promise<void> {
  const { error } = await getServiceClient()
    .from('user_risk_settings')
    .update({ kill_switch_active: false } as never)
    .eq('user_id', userId)
  if (error) throw new Error(`kill switch release failed: ${error.message}`)
  await auditLog(userId, 'risk.kill_switch_released', {})
  await notify(
    userId,
    'kill_switch',
    'Kill switch released',
    'New entries are re-enabled at the risk gate. Strategies remain paused — re-activate them individually when ready.',
  )
}

/** Worker sweeper: while the switch is on, keep retrying square-offs for stragglers. */
export async function killSwitchSweep(userId: string): Promise<void> {
  const store = supabaseRiskStore()
  const settings = await store.getSettings(userId)
  if (!settings?.kill_switch_active) return
  const open = await ledger.getOpenPositions(userId)
  if (open.length === 0) return
  logger.warn('kill switch sweep: positions still open, re-running', { userId, open: open.length })
  await executeKillSwitch(userId)
}

/** Gate read used by the worker loop: is the switch on for this user? */
export async function isKillSwitchActive(userId: string): Promise<boolean> {
  const settings = await supabaseRiskStore().getSettings(userId)
  return settings?.kill_switch_active ?? false
}
