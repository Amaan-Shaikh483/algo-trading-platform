-- ═══════════════════════════════════════════════════════════════════════════
-- 00002_strategy_perf.sql — per-strategy performance rollup (spec 3.4 list
-- screen: "last-run P&L", today's P&L, win rate). Read via the backend with an
-- explicit user_id filter; security_invoker keeps user-JWT reads RLS-safe.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view public.strategy_perf
with (security_invoker = true) as
select
  s.id          as strategy_id,
  s.user_id     as user_id,
  coalesce(sum(t.pnl), 0)::numeric                                        as total_pnl,
  coalesce(sum(t.pnl) filter (
    where (t.exit_time at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date
  ), 0)::numeric                                                          as today_pnl,
  count(t.id)                                                             as total_trades,
  coalesce(avg(case when t.pnl > 0 then 1.0 else 0.0 end), 0)::numeric    as win_rate,
  max(t.exit_time)                                                        as last_exit_time
from public.strategies s
left join public.trade_logs t on t.strategy_id = s.id
group by s.id, s.user_id;
