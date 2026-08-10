-- 00004: Strategy legs + split long/short entry conditions.
--
-- The builder now supports Option Trading - Time Based & Indicator Based legs
-- (option legs, incl. time-triggered entry) and split Long/Short entry
-- conditions. These live in the `rules` JSONB blob as the single source of
-- truth, but we mirror them into dedicated nullable JSONB columns for querying
-- and reporting (parity with risk_settings).
alter table public.strategies
  add column if not exists long_entry_conditions jsonb,
  add column if not exists short_entry_conditions jsonb,
  add column if not exists legs jsonb;

-- Backfill from existing rules so previously saved strategies (if any) expose
-- the mirrored columns without needing a re-save.
update public.strategies
set
  long_entry_conditions  = coalesce(rules -> 'longEntryConditions',  null),
  short_entry_conditions = coalesce(rules -> 'shortEntryConditions', null),
  legs                   = coalesce(rules -> 'legs',                 null)
where long_entry_conditions is null
   or short_entry_conditions is null
   or legs is null;
