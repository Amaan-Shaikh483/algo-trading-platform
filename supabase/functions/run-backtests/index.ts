// run-backtests edge function (spec 3.5 — backtest queue sweeper).
//
// The backend kicks a run in-process the moment it is queued, so this every-
// minute sweeper only needs to drain anything orphaned by a crash/restart:
// it forwards to the backend's secured internal endpoint, which claims 'queued'
// backtest_runs rows and replays them with historical broker data.
//
// Required secrets: INTERNAL_API_BASE_URL, CRON_SECRET (shared with backend).

const internalBaseUrl = Deno.env.get('INTERNAL_API_BASE_URL')
const cronSecret = Deno.env.get('CRON_SECRET')

Deno.serve(async () => {
  if (!internalBaseUrl || !cronSecret) {
    return new Response(
      JSON.stringify({ ok: false, reason: 'INTERNAL_API_BASE_URL / CRON_SECRET secrets not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  try {
    const response = await fetch(`${internalBaseUrl.replace(/\/$/, '')}/internal/jobs/run-backtests`, {
      method: 'POST',
      headers: { 'x-cron-secret': cronSecret, 'Content-Type': 'application/json' },
      body: '{}',
    })
    const body = await response.json().catch(() => ({}))
    return new Response(JSON.stringify({ ok: response.ok, status: response.status, ...body }), {
      status: response.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, reason: (err as Error).message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
