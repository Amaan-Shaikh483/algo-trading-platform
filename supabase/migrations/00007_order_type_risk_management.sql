-- ═══════════════════════════════════════════════════════════════════════════
-- 00007: Order Type + Risk Management configuration on strategies.
--
-- The builder gained two new configuration blocks:
--   * Order Type       — MIS / CNC / BTST, session window (start + square off,
--                        or next-day square off for BTST), allowed trading
--                        days, and for CNC the entry/exit trading-days-before-
--                        expiry window (0…4).
--   * Risk Management  — global exit profit / exit loss (INR), max trade cycle,
--                        no-trade-after cutoff and the profit-trailing mode
--                        (no trailing / lock fix / trail / lock & trail).
--
-- Both live inside the versioned `rules` JSONB (single source of truth for the
-- backtest + live engines), and are ALSO mirrored into dedicated nullable
-- JSONB columns for querying and reporting — same pattern as risk_settings and
-- the 00004 legs/long_entry_conditions columns.
--
-- Backward compatibility: the columns are nullable and every existing row is
-- backfilled with a value derived from its current rules (product type →
-- order type, exit.timeSquareOff → square off time, exit.overallProfitAmount /
-- overallLossAmount → exit profit / loss). No strategy breaks and no API call
-- fails because the new fields were missing.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.strategies
  add column if not exists order_type      jsonb,
  add column if not exists risk_management jsonb;

comment on column public.strategies.order_type is
  'Order Type block mirrored from rules->orderType: {type: MIS|CNC|BTST, startTime, squareOffTime, nextDaySquareOffTime, tradingDays[], cnc:{entryDaysBeforeExpiry, exitDaysBeforeExpiry}}';
comment on column public.strategies.risk_management is
  'Risk Management block mirrored from rules->riskManagement: {exitProfit, exitLoss, maxTradeCycle, noTradeAfter, profitTrailing:{type, ifProfitReaches, lockProfitAt, onEveryIncreaseOf, trailProfitBy}}';

-- ── Backfill: prefer the block already present in rules, else derive it ──────

update public.strategies
set order_type = coalesce(
  rules -> 'orderType',
  jsonb_build_object(
    'type',
      case coalesce(rules -> 'entry' ->> 'productType', 'INTRADAY')
        when 'DELIVERY' then 'CNC'
        when 'MARGIN'   then 'CNC'
        when 'BTST'     then 'BTST'
        else 'MIS'
      end,
    'startTime', '09:16',
    'squareOffTime',
      case when coalesce(rules -> 'entry' ->> 'productType', 'INTRADAY') = 'BTST'
        then null
        else coalesce(rules -> 'exit' -> 'timeSquareOff' ->> 'time', '15:10')
      end,
    'nextDaySquareOffTime',
      case when coalesce(rules -> 'entry' ->> 'productType', 'INTRADAY') = 'BTST'
        then coalesce(rules -> 'exit' -> 'timeSquareOff' ->> 'time', '15:10')
        else null
      end,
    'tradingDays', jsonb_build_array('MON', 'TUE', 'WED', 'THU', 'FRI')
  )
  -- CNC rows additionally get the default 4 / 0 expiry window below.
)
where order_type is null;

-- CNC rows need the cnc sub-object (entry 4 / exit 0 defaults per the spec).
update public.strategies
set order_type = order_type || jsonb_build_object(
  'cnc', jsonb_build_object('entryDaysBeforeExpiry', 4, 'exitDaysBeforeExpiry', 0)
)
where order_type ->> 'type' = 'CNC'
  and order_type -> 'cnc' is null;

update public.strategies
set risk_management = coalesce(
  rules -> 'riskManagement',
  jsonb_strip_nulls(jsonb_build_object(
    'exitProfit',
      case when (rules -> 'exit' ->> 'overallProfitAmount') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then abs((rules -> 'exit' ->> 'overallProfitAmount')::numeric)
        else null
      end,
    'exitLoss',
      case when (rules -> 'exit' ->> 'overallLossAmount') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then abs((rules -> 'exit' ->> 'overallLossAmount')::numeric)
        else null
      end,
    'maxTradeCycle', 1,
    'noTradeAfter', coalesce(rules -> 'exit' -> 'timeSquareOff' ->> 'time', '15:10'),
    'profitTrailing', jsonb_build_object('type', 'NO_TRAILING')
  ))
)
where risk_management is null;

-- Keep the mirrored blocks inside `rules` too, so engines reading only `rules`
-- (backtest + live runtime) see the same configuration as the API/DB columns.
update public.strategies
set rules = jsonb_set(
  jsonb_set(rules, '{orderType}', order_type, true),
  '{riskManagement}', risk_management, true
)
where rules -> 'orderType' is null
   or rules -> 'riskManagement' is null;

-- Query helpers for reporting (e.g. "all CNC strategies", "trailing enabled").
create index if not exists strategies_order_type_kind_idx
  on public.strategies ((order_type ->> 'type'));
create index if not exists strategies_profit_trailing_idx
  on public.strategies ((risk_management -> 'profitTrailing' ->> 'type'));
