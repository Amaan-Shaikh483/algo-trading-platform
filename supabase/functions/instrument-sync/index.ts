// instrument-sync edge function (spec 3.3 — daily scrip-master cache refresh).
//
// Runs daily pre-market via Supabase cron (see supabase/CRON_SETUP.md) and
// forwards to the backend's secured internal endpoint, which downloads the
// official scrip-master JSON and batch-upsets the `instruments` table. Heavy
// lifting stays in Node (the file can exceed 80MB; edge functions have tight
// memory limits).
//
// Required secrets: INTERNAL_API_BASE_URL, CRON_SECRET (shared with backend).

const internalBaseUrl = Deno.env.get('INTERNAL_API_BASE_URL')
const cronSecret = Deno.env.get('CRON_SECRET')

Deno.serve(async (req) => {
  if (!internalBaseUrl || !cronSecret) {
    return new Response(
      JSON.stringify({ ok: false, reason: 'INTERNAL_API_BASE_URL / CRON_SECRET secrets not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const url = new URL(req.url)
  const passthrough = url.search // allow ?maxRecords= / ?dryRun=1 through for ops smoke tests

  try {
    const response = await fetch(
      `${internalBaseUrl.replace(/\/$/, '')}/internal/jobs/instrument-sync${passthrough}`,
      {
        method: 'POST',
        headers: { 'x-cron-secret': cronSecret, 'Content-Type': 'application/json' },
        body: '{}',
      },
    )
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
