import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { env } from '../config/env'
import type { Database } from './types'

/**
 * supabase-js ≥2.100 constructs a RealtimeClient eagerly, which THROWS on
 * Node < 22 (no native WebSocket). The backend never opens realtime channels
 * (PostgREST/Auth/RPC only), but construction must not be fatal — polyfill
 * from the `ws` package (same one SmartAPI uses).
 */
const g = globalThis as { WebSocket?: unknown }
if (typeof g.WebSocket === 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    g.WebSocket = (require('ws') as { WebSocket?: unknown }).WebSocket
  } catch {
    /* realtime unusable here but REST/RPC remain functional */
  }
}

let cached: SupabaseClient<Database> | null = null

/**
 * Service-role client (bypasses RLS). Used ONLY on the backend for jobs and
 * cross-user maintenance. All user-scoped queries must still filter by
 * user_id explicitly — RLS won't save you with this key.
 */
export function getServiceClient(): SupabaseClient<Database> {
  if (!cached) {
    cached = createClient<Database>(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return cached
}

/**
 * Verify a user JWT (forwarded from the frontend) against Supabase Auth and
 * return the authenticated user's id, or null if invalid/expired.
 */
export async function verifyUserJwt(jwt: string): Promise<string | null> {
  const client = getServiceClient()
  const { data, error } = await client.auth.getUser(jwt)
  if (error || !data.user) return null
  return data.user.id
}
