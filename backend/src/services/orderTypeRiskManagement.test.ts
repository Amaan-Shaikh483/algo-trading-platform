import { describe, expect, it } from 'vitest'
import {
  RULE_SCHEMA_VERSION,
  defaultOrderType,
  defaultRiskManagement,
  normalizeOrderType,
  normalizeRiskManagement,
  orderTypeForProductType,
  productTypeForOrderType,
  validateOrderTypeConfig,
  validateRiskManagementConfig,
  validateStrategyRules,
} from '@algo/rule-schema'
import type { OrderTypeConfig, RiskManagementConfig, StrategyRules } from '@algo/rule-schema'
import {
  ProfitTrailer,
  buildSessionGates,
  canOpenNewTrade,
  hitOverallLimit,
  isPastSquareOff,
  istWeekday,
  maxTradeCycleFor,
} from './engine/sessionGates'

/**
 * Covers the Order Type (MIS/CNC/BTST) and Risk Management (limits + profit
 * trailing) configuration: shared validation, backward-compatible
 * normalization of pre-feature strategies, and the engine session gates.
 */

function base(over: Partial<StrategyRules> = {}): StrategyRules {
  return {
    version: RULE_SCHEMA_VERSION,
    direction: { side: 'long' },
    entry: { orderType: 'MARKET', productType: 'INTRADAY' },
    entryConditions: {
      combinator: 'and',
      conditions: [
        {
          id: 'c1',
          left: { kind: 'indicator', indicator: 'ema', params: { period: 9 }, output: 'value' },
          operator: 'crosses_above',
          right: { kind: 'indicator', indicator: 'ema', params: { period: 21 }, output: 'value' },
        },
      ],
    },
    exit: { timeSquareOff: { time: '15:10' } },
    risk: { quantity: 1, maxConcurrentPositions: 1, maxTradesPerDay: 5 },
    ...over,
  }
}

/** An IST instant for a given weekday + HH:mm (IST = UTC+5:30). */
function istAt(dateIso: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const utcMinutes = h * 60 + m - (5 * 60 + 30)
  return new Date(`${dateIso}T00:00:00Z`).getTime() + utcMinutes * 60000 > 0
    ? new Date(new Date(`${dateIso}T00:00:00Z`).getTime() + utcMinutes * 60000)
    : new Date(`${dateIso}T00:00:00Z`)
}

describe('order type validation', () => {
  it('accepts a well-formed MIS configuration', () => {
    expect(validateOrderTypeConfig(defaultOrderType('MIS'))).toEqual([])
  })

  it('accepts CNC with entry/exit days inside 0…4', () => {
    const cfg = defaultOrderType('CNC')
    expect(cfg.cnc).toEqual({ entryDaysBeforeExpiry: 4, exitDaysBeforeExpiry: 0 })
    expect(validateOrderTypeConfig(cfg)).toEqual([])
  })

  it('rejects CNC entry/exit days outside 0…4', () => {
    const cfg: OrderTypeConfig = {
      ...defaultOrderType('CNC'),
      cnc: { entryDaysBeforeExpiry: 7, exitDaysBeforeExpiry: -1 },
    }
    const errors = validateOrderTypeConfig(cfg)
    expect(errors.some((e) => e.includes('entryDaysBeforeExpiry'))).toBe(true)
    expect(errors.some((e) => e.includes('exitDaysBeforeExpiry'))).toBe(true)
  })

  it('requires CNC settings only when CNC is selected', () => {
    const missing: OrderTypeConfig = { ...defaultOrderType('CNC'), cnc: undefined }
    expect(validateOrderTypeConfig(missing).some((e) => e.includes('cnc settings are required'))).toBe(true)
    // MIS must NOT carry CNC settings.
    const leaked: OrderTypeConfig = { ...defaultOrderType('MIS'), cnc: { entryDaysBeforeExpiry: 1, exitDaysBeforeExpiry: 1 } }
    expect(validateOrderTypeConfig(leaked).some((e) => e.includes('only allowed when CNC'))).toBe(true)
  })

  it('requires next-day square off for BTST and forbids same-day square off', () => {
    const cfg = defaultOrderType('BTST')
    expect(cfg.squareOffTime).toBeNull()
    expect(cfg.nextDaySquareOffTime).toBe('15:10')
    expect(validateOrderTypeConfig(cfg)).toEqual([])
    expect(
      validateOrderTypeConfig({ ...cfg, nextDaySquareOffTime: null }).some((e) => e.includes('nextDaySquareOffTime')),
    ).toBe(true)
  })

  it('rejects invalid times and start ≥ square off', () => {
    expect(validateOrderTypeConfig({ ...defaultOrderType(), startTime: '25:99' }).some((e) => e.includes('startTime'))).toBe(true)
    expect(
      validateOrderTypeConfig({ ...defaultOrderType(), startTime: '15:30' }).some((e) => e.includes('before')),
    ).toBe(true)
  })

  it('rejects unsupported or empty trading days', () => {
    expect(validateOrderTypeConfig({ ...defaultOrderType(), tradingDays: [] }).some((e) => e.includes('at least one'))).toBe(true)
    const bad = { ...defaultOrderType(), tradingDays: ['SUN'] as never }
    expect(validateOrderTypeConfig(bad).some((e) => e.includes('unsupported day'))).toBe(true)
  })

  it('round-trips order type ↔ product type', () => {
    expect(productTypeForOrderType('MIS')).toBe('INTRADAY')
    expect(productTypeForOrderType('CNC')).toBe('DELIVERY')
    expect(productTypeForOrderType('BTST')).toBe('BTST')
    expect(orderTypeForProductType('DELIVERY')).toBe('CNC')
    expect(orderTypeForProductType('BTST')).toBe('BTST')
    expect(orderTypeForProductType(undefined)).toBe('MIS')
  })
})

describe('risk management validation', () => {
  it('accepts the default (no trailing) configuration', () => {
    expect(validateRiskManagementConfig(defaultRiskManagement())).toEqual([])
  })

  it('requires lock fields only for Lock Fix Profit', () => {
    const cfg: RiskManagementConfig = {
      ...defaultRiskManagement(),
      profitTrailing: { type: 'LOCK_FIX_PROFIT' },
    }
    const errors = validateRiskManagementConfig(cfg)
    expect(errors.some((e) => e.includes('ifProfitReaches'))).toBe(true)
    expect(errors.some((e) => e.includes('lockProfitAt'))).toBe(true)
    // Trail-only fields are NOT required for this mode.
    expect(errors.some((e) => e.includes('trailProfitBy'))).toBe(false)

    cfg.profitTrailing = { type: 'LOCK_FIX_PROFIT', ifProfitReaches: 5000, lockProfitAt: 3000 }
    expect(validateRiskManagementConfig(cfg)).toEqual([])
  })

  it('requires trail fields only for Trail Profit', () => {
    const cfg: RiskManagementConfig = { ...defaultRiskManagement(), profitTrailing: { type: 'TRAIL_PROFIT' } }
    const errors = validateRiskManagementConfig(cfg)
    expect(errors.some((e) => e.includes('onEveryIncreaseOf'))).toBe(true)
    expect(errors.some((e) => e.includes('ifProfitReaches'))).toBe(false)
  })

  it('requires all four fields for Lock & Trail', () => {
    const cfg: RiskManagementConfig = { ...defaultRiskManagement(), profitTrailing: { type: 'LOCK_AND_TRAIL' } }
    expect(validateRiskManagementConfig(cfg)).toHaveLength(4)

    cfg.profitTrailing = {
      type: 'LOCK_AND_TRAIL',
      ifProfitReaches: 5000,
      lockProfitAt: 3000,
      onEveryIncreaseOf: 500,
      trailProfitBy: 300,
    }
    expect(validateRiskManagementConfig(cfg)).toEqual([])
  })

  it('rejects a lock above the trigger, bad cycles and bad times', () => {
    expect(
      validateRiskManagementConfig({
        ...defaultRiskManagement(),
        profitTrailing: { type: 'LOCK_FIX_PROFIT', ifProfitReaches: 1000, lockProfitAt: 5000 },
      }).some((e) => e.includes('cannot exceed')),
    ).toBe(true)
    expect(
      validateRiskManagementConfig({ ...defaultRiskManagement(), maxTradeCycle: 0 }).some((e) => e.includes('maxTradeCycle')),
    ).toBe(true)
    expect(
      validateRiskManagementConfig({ ...defaultRiskManagement(), noTradeAfter: '99:99' }).some((e) =>
        e.includes('noTradeAfter'),
      ),
    ).toBe(true)
  })
})

describe('backward compatibility', () => {
  it('validates strategies saved before the feature existed', () => {
    const legacy = base()
    delete (legacy as Partial<StrategyRules>).orderType
    delete (legacy as Partial<StrategyRules>).riskManagement
    expect(validateStrategyRules(legacy).valid).toBe(true)
  })

  it('derives the order type from the legacy product type + square-off time', () => {
    const legacy = base({ entry: { orderType: 'MARKET', productType: 'DELIVERY' } })
    const ot = normalizeOrderType(legacy)
    expect(ot.type).toBe('CNC')
    expect(ot.squareOffTime).toBe('15:10')
    expect(ot.tradingDays).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI'])
    expect(ot.cnc).toEqual({ entryDaysBeforeExpiry: 4, exitDaysBeforeExpiry: 0 })
  })

  it('maps a legacy BTST product type onto the next-day square off', () => {
    const legacy = base({ entry: { orderType: 'MARKET', productType: 'BTST' } })
    const ot = normalizeOrderType(legacy)
    expect(ot.type).toBe('BTST')
    expect(ot.squareOffTime).toBeNull()
    expect(ot.nextDaySquareOffTime).toBe('15:10')
  })

  it('derives risk management from legacy overall profit/loss amounts', () => {
    const legacy = base({ exit: { timeSquareOff: { time: '15:10' }, overallProfitAmount: 5000, overallLossAmount: 1000 } })
    const rm = normalizeRiskManagement(legacy)
    expect(rm.exitProfit).toBe(5000)
    expect(rm.exitLoss).toBe(1000)
    expect(rm.maxTradeCycle).toBe(1)
    expect(rm.profitTrailing.type).toBe('NO_TRAILING')
  })

  it('clamps out-of-range CNC days and prunes trailing fields for the mode', () => {
    const rules = base({
      orderType: { ...defaultOrderType('CNC'), cnc: { entryDaysBeforeExpiry: 99, exitDaysBeforeExpiry: -5 } },
      riskManagement: {
        ...defaultRiskManagement(),
        profitTrailing: { type: 'TRAIL_PROFIT', ifProfitReaches: 1, onEveryIncreaseOf: 500, trailProfitBy: 300 },
      },
    })
    expect(normalizeOrderType(rules).cnc).toEqual({ entryDaysBeforeExpiry: 4, exitDaysBeforeExpiry: 0 })
    // ifProfitReaches is irrelevant to TRAIL_PROFIT and must not persist.
    expect(normalizeRiskManagement(rules).profitTrailing.ifProfitReaches).toBeUndefined()
  })

  it('surfaces invalid new-block config through validateStrategyRules', () => {
    const rules = base({ orderType: { ...defaultOrderType('MIS'), tradingDays: [] } })
    const result = validateStrategyRules(rules)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('tradingDays'))).toBe(true)
  })
})

describe('session gates', () => {
  it('reports IST weekdays', () => {
    // 2026-08-14 is a Friday.
    expect(istWeekday(istAt('2026-08-14', '10:00'))).toBe('FRI')
    expect(istWeekday(istAt('2026-08-17', '10:00'))).toBe('MON')
  })

  it('blocks entries outside the session window and on excluded days', () => {
    const gates = buildSessionGates(base({ orderType: defaultOrderType('MIS') }))
    expect(canOpenNewTrade(gates, istAt('2026-08-14', '10:00'))).toBe(true)
    expect(canOpenNewTrade(gates, istAt('2026-08-14', '09:00'))).toBe(false) // before start
    expect(canOpenNewTrade(gates, istAt('2026-08-14', '15:30'))).toBe(false) // after cutoff

    const monOnly = buildSessionGates(
      base({ orderType: { ...defaultOrderType('MIS'), tradingDays: ['MON'] } }),
    )
    expect(canOpenNewTrade(monOnly, istAt('2026-08-14', '10:00'))).toBe(false) // Friday
    expect(canOpenNewTrade(monOnly, istAt('2026-08-17', '10:00'))).toBe(true) // Monday
  })

  it('honours the No Trade After cutoff when earlier than square off', () => {
    const gates = buildSessionGates(
      base({
        orderType: { ...defaultOrderType('MIS'), squareOffTime: '15:20' },
        riskManagement: { ...defaultRiskManagement(), noTradeAfter: '14:00' },
      }),
    )
    expect(canOpenNewTrade(gates, istAt('2026-08-14', '13:59'))).toBe(true)
    expect(canOpenNewTrade(gates, istAt('2026-08-14', '14:00'))).toBe(false)
    // Open positions still run until square off.
    expect(isPastSquareOff(gates, istAt('2026-08-14', '14:30'))).toBe(false)
    expect(isPastSquareOff(gates, istAt('2026-08-14', '15:20'))).toBe(true)
  })

  it('has no same-day square off for BTST', () => {
    const gates = buildSessionGates(base({ orderType: defaultOrderType('BTST') }))
    expect(gates.squareOffMinutes).toBeNull()
    expect(isPastSquareOff(gates, istAt('2026-08-14', '15:30'))).toBe(false)
  })

  it('never retroactively gates a strategy saved before the feature', () => {
    // Backward-compatibility contract: an absent orderType / riskManagement
    // block means "no new gating" — an old strategy must trade exactly when it
    // used to, including outside the new default 09:16–15:10 window and on any
    // weekday. The normalized defaults are only what the BUILDER displays.
    const legacy = base()
    delete (legacy as Partial<StrategyRules>).orderType
    delete (legacy as Partial<StrategyRules>).riskManagement
    const gates = buildSessionGates(legacy)

    expect(gates.hasOrderTypeConfig).toBe(false)
    expect(gates.hasRiskManagementConfig).toBe(false)
    expect(gates.startMinutes).toBeNull()
    expect(gates.noNewTradeMinutes).toBeNull()
    expect(gates.squareOffMinutes).toBeNull()
    expect(maxTradeCycleFor(gates)).toBeNull()

    // Displayed defaults are still MIS / Mon–Fri for the builder.
    expect(gates.orderType.type).toBe('MIS')

    // …but no instant is blocked, including before 09:16 and on a Saturday.
    expect(canOpenNewTrade(gates, istAt('2026-08-14', '10:00'))).toBe(true)
    expect(canOpenNewTrade(gates, istAt('2026-08-14', '08:00'))).toBe(true)
    expect(canOpenNewTrade(gates, istAt('2026-08-14', '23:00'))).toBe(true)
    expect(canOpenNewTrade(gates, istAt('2026-08-15', '10:00'))).toBe(true) // Saturday
    expect(isPastSquareOff(gates, istAt('2026-08-14', '23:59'))).toBe(false)
  })

  it('gates only once the strategy explicitly configures the blocks', () => {
    const configured = buildSessionGates(
      base({ orderType: { ...defaultOrderType('MIS'), tradingDays: ['MON'] } }),
    )
    expect(configured.hasOrderTypeConfig).toBe(true)
    expect(canOpenNewTrade(configured, istAt('2026-08-14', '10:00'))).toBe(false) // Friday excluded
  })
})

describe('overall limits and profit trailing', () => {
  it('detects overall profit and loss breaches', () => {
    const cfg = { ...defaultRiskManagement(), exitProfit: 5000, exitLoss: 1000 }
    expect(hitOverallLimit(cfg, 4999)).toBeNull()
    expect(hitOverallLimit(cfg, 5000)).toBe('profit')
    expect(hitOverallLimit(cfg, -1000)).toBe('loss')
    expect(hitOverallLimit(defaultRiskManagement(), 999999)).toBeNull()
  })

  it('no trailing never books', () => {
    const t = new ProfitTrailer(defaultRiskManagement())
    expect(t.shouldBook(100000)).toBe(false)
  })

  it('lock fix profit arms at the trigger and books on give-back', () => {
    const t = new ProfitTrailer({
      ...defaultRiskManagement(),
      profitTrailing: { type: 'LOCK_FIX_PROFIT', ifProfitReaches: 5000, lockProfitAt: 3000 },
    })
    expect(t.shouldBook(4000)).toBe(false) // not armed yet
    expect(t.update(5000)).toBe(3000) // armed
    expect(t.shouldBook(4000)).toBe(false) // still above the floor
    expect(t.shouldBook(3000)).toBe(true) // fell back to the locked floor
  })

  it('trail profit ratchets the floor by each step', () => {
    const t = new ProfitTrailer({
      ...defaultRiskManagement(),
      profitTrailing: { type: 'TRAIL_PROFIT', onEveryIncreaseOf: 500, trailProfitBy: 300 },
    })
    expect(t.update(400)).toBeNull()
    expect(t.update(500)).toBe(300)
    expect(t.update(1000)).toBe(600)
    expect(t.shouldBook(600)).toBe(true)
  })

  it('lock & trail locks first, then trails above the lock', () => {
    const t = new ProfitTrailer({
      ...defaultRiskManagement(),
      profitTrailing: {
        type: 'LOCK_AND_TRAIL',
        ifProfitReaches: 5000,
        lockProfitAt: 3000,
        onEveryIncreaseOf: 500,
        trailProfitBy: 300,
      },
    })
    expect(t.update(4000)).toBeNull() // lock not armed
    expect(t.update(5000)).toBe(3000) // locked
    expect(t.update(5500)).toBe(3300) // one trail step above the lock
    expect(t.update(6000)).toBe(3600)
    expect(t.shouldBook(3600)).toBe(true)
  })

  it('resets between trading days', () => {
    const t = new ProfitTrailer({
      ...defaultRiskManagement(),
      profitTrailing: { type: 'LOCK_FIX_PROFIT', ifProfitReaches: 5000, lockProfitAt: 3000 },
    })
    t.update(5000)
    expect(t.lockedProfit).toBe(3000)
    t.reset()
    expect(t.lockedProfit).toBeNull()
  })
})
