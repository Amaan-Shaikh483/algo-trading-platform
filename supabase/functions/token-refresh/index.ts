// token-refresh edge function (spec 3.2 — refreshSession scheduled job).
//
// Runs daily pre-market, 08:00 IST, via Supabase cron (see supabase/CRON_SETUP.md).
// Delegates the actual SmartAPI work to the backend's secured internal endpoint
// — the official smartapi-javascript SDK is Node/CommonJS and stays maintained
// there, rather than re-implementing REST calls here in Deno.
//
// Required secrets (supabase secrets set ...):
//   INTERNAL_API_BASE_URL  e.g. https://your-backend.onrender.com
//   CRON_SECRET            must match the backend's CRON_SECRET env var

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
    const response = await fetch(`${internalBaseUrl.replace(/\/$/, '')}/internal/jobs/token-refresh`, {
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
