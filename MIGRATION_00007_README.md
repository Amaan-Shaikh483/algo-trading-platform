# Migration 00007: Order Type & Risk Management configuration

## Summary

Adds the builder's **Order Type** (MIS / CNC / BTST) and **Risk Management**
(global limits + profit trailing) configuration to strategies, end to end:
shared schema → validation → API → database → backtest/live engines → UI.

## Applying it

```bash
node apply-migration-00007.mjs           # applies via SUPABASE_DB_URL (backend/.env)
node apply-migration-00007.mjs --print   # prints the SQL for the Supabase SQL editor
# or
npx supabase db push
```

The migration is idempotent (`add column if not exists` + guarded backfills),
so re-running it is safe.

## Database changes

`supabase/migrations/00007_order_type_risk_management.sql` adds two nullable
JSONB columns to `public.strategies`, mirroring what lives inside the versioned
`rules` blob (same pattern as `risk_settings` and the 00004 `legs` column):

| Column            | Contents |
|-------------------|----------|
| `order_type`      | `{type, startTime, squareOffTime, nextDaySquareOffTime, tradingDays[], cnc:{entryDaysBeforeExpiry, exitDaysBeforeExpiry}}` |
| `risk_management` | `{exitProfit, exitLoss, maxTradeCycle, noTradeAfter, profitTrailing:{type, ifProfitReaches, lockProfitAt, onEveryIncreaseOf, trailProfitBy}}` |

Two expression indexes support reporting (`order_type ->> 'type'` and
`risk_management -> 'profitTrailing' ->> 'type'`).

### Backfill

Every existing row is backfilled from its current rules, so nothing is lost:

* `entry.productType` → order type (`DELIVERY`/`MARGIN` → CNC, `BTST` → BTST, else MIS)
* `exit.timeSquareOff.time` → square-off (or next-day square-off for BTST)
* `exit.overallProfitAmount` / `overallLossAmount` → exit profit / exit loss
* trading days default to MON–FRI; CNC rows get the 4 / 0 expiry window

Both blocks are then written back into `rules` so the engines (which read only
`rules`) see the same configuration as the API and the mirrored columns.

## API

`POST`/`PUT /api/strategies` accept the blocks inside `rules` (source of truth
for the engines) **and** at the payload root:

```json
{
  "orderType": {
    "type": "CNC",
    "startTime": "09:16",
    "squareOffTime": "15:10",
    "nextDaySquareOffTime": null,
    "tradingDays": ["MON", "TUE", "WED", "THU", "FRI"],
    "cnc": { "entryDaysBeforeExpiry": 4, "exitDaysBeforeExpiry": 0 }
  },
  "riskManagement": {
    "exitProfit": 5000,
    "exitLoss": 1000,
    "maxTradeCycle": 1,
    "noTradeAfter": "15:10",
    "profitTrailing": {
      "type": "LOCK_AND_TRAIL",
      "ifProfitReaches": 5000,
      "lockProfitAt": 3000,
      "onEveryIncreaseOf": 500,
      "trailProfitBy": 300
    }
  }
}
```

When both are supplied the top-level block wins. Responses always include both
blocks — legacy rows get them derived at read time.

## Backward compatibility

**Old strategies keep working and keep behaving identically.**

* Both columns are nullable; the API never errors on missing fields.
* Reads project sane defaults (`normalizeOrderType` / `normalizeRiskManagement`)
  so editing a pre-feature strategy opens with correct values.
* **The engines only gate on blocks a strategy actually configured.** An absent
  block means "no new gating" — an old strategy is *not* retroactively confined
  to the new default 09:16–15:10 / Mon–Fri window. This is locked by the test
  `never retroactively gates a strategy saved before the feature`
  (`backend/src/services/orderTypeRiskManagement.test.ts`) and by the 35-check
  engine harness.

## Rollback

```sql
alter table public.strategies
  drop column if exists order_type,
  drop column if exists risk_management;
```

The `rules` blob retains both blocks; the schema treats them as optional, so
the application continues to work after a rollback.
