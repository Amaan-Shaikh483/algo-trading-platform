-- 00008: Scope the dynamic Order Type configuration to indicator strategies.
--
-- Migration 00007 initially backfilled rules->orderType for every strategy.
-- Option Trading - Time Based is intentionally still driven by its original
-- entry.productType + exit.timeSquareOff fields. Remove only the derived/new
-- block from time-triggered option rows (identified by at least one leg with an
-- entryTime), while preserving MIS/CNC/BTST in entry.productType and all timing,
-- leg, risk, and other strategy data.

begin;

update public.strategies
set
  rules = rules - 'orderType',
  order_type = null
where segment = 'options'
  and (
    rules ->> 'strategyType' = 'option-time'
    or (
      rules ->> 'strategyType' is null
      and jsonb_array_length(coalesce(rules -> 'longEntryConditions' -> 'conditions', '[]'::jsonb)) = 0
      and jsonb_array_length(coalesce(rules -> 'shortEntryConditions' -> 'conditions', '[]'::jsonb)) = 0
      and exists (
        select 1
        from jsonb_array_elements(coalesce(rules -> 'legs', '[]'::jsonb)) as leg
        where nullif(leg ->> 'entryTime', '') is not null
      )
    )
  );

comment on column public.strategies.order_type is
  'Dynamic Order Type block mirrored from rules->orderType for indicator strategies: {type: MIS|CNC|BTST, startTime, squareOffTime, nextDaySquareOffTime, tradingDays[], cnc:{entryDaysBeforeExpiry, exitDaysBeforeExpiry}}. Null for legacy Option Time Based strategies.';

commit;
