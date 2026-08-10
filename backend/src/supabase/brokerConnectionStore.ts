import { getServiceClient } from './client'
import { encryptSecret, decryptSecret } from '../lib/crypto'
import type { BrokerCredentials, BrokerSession, ConnectionStatus } from '../services/brokers/types'
import type { Tables } from './types'

export interface StoredConnection extends Tables<'broker_connections'> {}

/**
 * Persistence for spec 3.2: encrypted credential storage, session token
 * persistence back into `broker_connections`, status transitions, and the
 * audit trail for connect/disconnect events. Server-side only (service role).
 */

export async function saveCredentials(
  userId: string,
  creds: Required<Pick<BrokerCredentials, 'apiKey' | 'clientCode' | 'totpSecret'>>,
): Promise<StoredConnection> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('broker_connections')
    .upsert(
      {
        user_id: userId,
        broker: 'angelone',
        api_key: encryptSecret(creds.apiKey),
        client_code: creds.clientCode, // client code is an identifier, not a secret
        totp_secret: encryptSecret(creds.totpSecret),
        status: 'disconnected',
        last_error: null,
      },
      { onConflict: 'user_id,broker' },
    )
    .select()
    .single()
  if (error) throw new Error(`Failed to save broker credentials: ${error.message}`)
  return data
}

export interface ConnectionCredentials {
  connection: StoredConnection
  apiKey: string
  clientCode: string
  totpSecret: string
}

export async function loadCredentials(connectionId: string): Promise<ConnectionCredentials> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('broker_connections')
    .select()
    .eq('id', connectionId)
    .single()
  if (error || !data) throw new Error(`Broker connection ${connectionId} not found`)
  return {
    connection: data,
    apiKey: decryptSecret(data.api_key),
    clientCode: data.client_code,
    totpSecret: decryptSecret(data.totp_secret),
  }
}

export async function loadSession(connectionId: string): Promise<BrokerSession | null> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('broker_connections')
    .select('jwt_token, refresh_token, feed_token, token_expiry')
    .eq('id', connectionId)
    .single()
  if (error || !data || !data.jwt_token || !data.refresh_token) return null
  return {
    jwtToken: data.jwt_token,
    refreshToken: data.refresh_token,
    feedToken: data.feed_token ?? '',
    expiresAt: data.token_expiry ? new Date(data.token_expiry) : new Date(0),
  }
}

/** Implements SessionPersistence.persistSession (spec 3.2). */
export async function persistSession(connectionId: string, session: BrokerSession): Promise<void> {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from('broker_connections')
    .update({
      jwt_token: session.jwtToken,
      refresh_token: session.refreshToken,
      feed_token: session.feedToken,
      token_expiry: session.expiresAt.toISOString(),
      status: 'connected',
      last_error: null,
    })
    .eq('id', connectionId)
  if (error) throw new Error(`Failed to persist session tokens: ${error.message}`)
}

/** Implements SessionPersistence.updateStatus (spec 3.2 status badge states). */
export async function updateStatus(
  connectionId: string,
  status: ConnectionStatus,
  lastError?: string,
): Promise<void> {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from('broker_connections')
    .update({ status, last_error: lastError ?? null })
    .eq('id', connectionId)
  if (error) throw new Error(`Failed to update connection status: ${error.message}`)
}

export async function saveBrokerProfile(connectionId: string, profile: unknown): Promise<void> {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from('broker_connections')
    .update({ broker_profile: profile as never })
    .eq('id', connectionId)
  if (error) throw new Error(`Failed to save broker profile: ${error.message}`)
}

/** Disconnect (spec 3.2): clear tokens, KEEP credentials + historical order/strategy data. */
export async function disconnect(connectionId: string): Promise<void> {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from('broker_connections')
    .update({
      jwt_token: null,
      refresh_token: null,
      feed_token: null,
      token_expiry: null,
      status: 'disconnected',
      last_error: null,
    })
    .eq('id', connectionId)
  if (error) throw new Error(`Failed to disconnect broker: ${error.message}`)
}

/** Hard remove: deletes the row incl. encrypted credentials. Historical orders/trades remain (they FK to user, not the connection). */
export async function removeConnection(connectionId: string, userId: string): Promise<void> {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from('broker_connections')
    .delete()
    .eq('id', connectionId)
    .eq('user_id', userId)
  if (error) throw new Error(`Failed to remove broker connection: ${error.message}`)
}

/** Light row lookup by connection id (user_id + status only) — used by the re-auth failure notifier. */
export async function getConnectionMeta(connectionId: string): Promise<{ id: string; user_id: string; status: string } | null> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('broker_connections')
    .select('id, user_id, status')
    .eq('id', connectionId)
    .maybeSingle()
  if (error) throw new Error(`Failed to load connection meta: ${error.message}`)
  return data
}

/** All connections with credentials (used by the daily pre-market re-login job). */
export async function getAllConnections(): Promise<StoredConnection[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('broker_connections')
    .select()
    .neq('status', 'invalid_credentials')
  if (error) throw new Error(`Failed to list broker connections: ${error.message}`)
  return data ?? []
}

export type AuditEventType =
  | 'auth.login'
  | 'auth.logout'
  | 'broker.connected'
  | 'broker.connect_failed'
  | 'broker.disconnected'
  | 'broker.token_expired'
  | 'broker.token_refreshed'
  | 'strategy.activated'
  | 'strategy.deactivated'

export async function recordAuditEvent(
  userId: string | null,
  eventType: AuditEventType | string,
  eventData: Record<string, unknown> = {},
): Promise<void> {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from('audit_logs')
    .insert({ user_id: userId, event_type: eventType, event_data: eventData as never })
  if (error) {
    // Audit failures must never break the trading path — log and move on.
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: 'audit insert failed', detail: error.message }))
  }
}
