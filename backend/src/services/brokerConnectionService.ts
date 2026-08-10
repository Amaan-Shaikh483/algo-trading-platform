import crypto from 'crypto'
import { getServiceClient } from '../supabase/client'
import * as store from '../supabase/brokerConnectionStore'
import { adapterRegistry, createAngelOneAdapter } from './brokers'
import type { BrokerCredentials, BrokerProfile, ConnectionStatus, SessionPersistence } from './brokers'
import { BrokerError } from './brokers'
import { HttpError } from '../lib/httpError'
import { logger } from '../lib/logger'
import { notify } from './userEvents'

/**
 * Broker-connect orchestration (spec 3.2): the flow behind the
 * "Connect Broker" screen — form → encrypted storage → session tokens →
 * status indicator — plus the daily token-refresh job entry point.
 */

export interface BrokerCredentialsInput {
  apiKey: string
  clientCode: string
  mpin: string
  totpSecret: string
}

export interface BrokerStatusView {
  configured: boolean
  connectionId: string | null
  broker: string
  status: ConnectionStatus | 'not_configured'
  clientCode: string | null
  tokenExpiry: string | null
  lastError: string | null
  /** Broker-side profile snapshot (client name, exchanges, products). */
  brokerProfile: unknown | null
}

function persistenceFor(connectionId: string): SessionPersistence {
  return {
    persistSession: (id, session) => store.persistSession(id, session),
    updateStatus: (id, status, lastError) => store.updateStatus(id, status, lastError),
    /**
     * MPIN-free re-login path: the MPIN is never stored, so automatic re-auth
     * uses the stored refresh token (SmartAPI generateToken). If the refresh
     * token is also stale we return null and the connection stays
     * token_expired until the user reconnects with their MPIN — §3.9's
     * "broker token expired / re-login failed" notification fires HERE, at
     * the point the automatic recovery is known to have failed.
     */
    reauthenticate: async (id) => {
      const [creds, stored] = await Promise.all([store.loadCredentials(id), store.loadSession(id)])
      if (!stored?.refreshToken) {
        const meta = await store.getConnectionMeta(id)
        if (meta) await notifyTokenExpired(id, meta.user_id, 'no stored session for automatic re-login')
        return null
      }
      const adapter = adapterRegistry.getOrCreate('angelone', id, persistenceFor(id))
      adapter.useSession(stored, creds.apiKey)
      try {
        return await adapter.refreshSession(stored.refreshToken)
      } catch (err) {
        const meta = await store.getConnectionMeta(id)
        if (meta) await notifyTokenExpired(id, meta.user_id, (err as Error).message)
        throw err
      }
    },
  }
}

function validateCredentialsInput(body: unknown): BrokerCredentialsInput {
  const b = (body ?? {}) as Record<string, unknown>
  for (const field of ['apiKey', 'clientCode', 'mpin', 'totpSecret'] as const) {
    if (typeof b[field] !== 'string' || !(b[field] as string).trim()) {
      throw new HttpError(400, `Field '${field}' is required`, 'VALIDATION')
    }
  }
  return {
    apiKey: (b.apiKey as string).trim(),
    clientCode: (b.clientCode as string).trim(),
    mpin: (b.mpin as string).trim(),
    totpSecret: (b.totpSecret as string).trim(),
  }
}

async function getConnectionRow(userId: string) {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('broker_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('broker', 'angelone')
    .limit(1)
    .maybeSingle()
  if (error) throw new HttpError(500, `Failed to load broker connection: ${error.message}`)
  return data
}

/**
 * "Test Connection" (spec 3.2): authenticates against SmartAPI WITHOUT
 * persisting anything — the user verifies credentials before saving.
 * Ephemeral adapter; logs out best-effort afterwards.
 */
export async function testConnection(userId: string, body: unknown): Promise<{ profile: BrokerProfile }> {
  const creds = validateCredentialsInput(body)
  const ephemeralId = `test-${crypto.randomUUID()}`
  const adapter = createAngelOneAdapter(ephemeralId)
  try {
    await adapter.login(creds)
    const profile = await adapter.getProfile()
    logger.info('broker test connection succeeded', { userId, clientCode: creds.clientCode })
    return { profile }
  } catch (err) {
    await store.recordAuditEvent(userId, 'broker.connect_failed', {
      mode: 'test',
      reason: (err as Error).message,
    })
    throw err
  } finally {
    await adapter.logout().catch(() => undefined)
  }
}

/**
 * "Connect & Save": encrypt + store credentials, login, persist the session
 * tokens, snapshot the broker profile, audit the event.
 */
export async function connect(userId: string, body: unknown): Promise<{ connectionId: string; status: ConnectionStatus; profile: BrokerProfile }> {
  const creds = validateCredentialsInput(body)
  const conn = await store.saveCredentials(userId, {
    apiKey: creds.apiKey,
    clientCode: creds.clientCode,
    totpSecret: creds.totpSecret,
  })
  const adapter = adapterRegistry.getOrCreate('angelone', conn.id, persistenceFor(conn.id))
  try {
    await adapter.login(creds)
    const profile = await adapter.getProfile()
    await store.saveBrokerProfile(conn.id, profile as unknown)
    await store.recordAuditEvent(userId, 'broker.connected', { broker: 'angelone', clientCode: creds.clientCode })
    return { connectionId: conn.id, status: 'connected', profile }
  } catch (err) {
    const isCredError = err instanceof BrokerError && err.kind === 'invalid_credentials'
    await store.updateStatus(conn.id, isCredError ? 'invalid_credentials' : 'disconnected', (err as Error).message)
    await store.recordAuditEvent(userId, 'broker.connect_failed', { mode: 'connect', reason: (err as Error).message })
    throw err
  }
}

/** Status for the connection badge + profile card. Never returns secrets. */
export async function getStatus(userId: string): Promise<BrokerStatusView> {
  const row = await getConnectionRow(userId)
  if (!row) {
    return {
      configured: false,
      connectionId: null,
      broker: 'angelone',
      status: 'not_configured',
      clientCode: null,
      tokenExpiry: null,
      lastError: null,
      brokerProfile: null,
    }
  }
  return {
    configured: true,
    connectionId: row.id,
    broker: row.broker,
    status: row.status,
    clientCode: row.client_code,
    tokenExpiry: row.token_expiry,
    lastError: row.last_error,
    brokerProfile: row.broker_profile,
  }
}

/** Re-login using stored credentials + freshly entered MPIN (token_expired / retry CTA path). */
export async function reconnect(userId: string, body: unknown): Promise<{ status: ConnectionStatus }> {
  const mpin = (body as Record<string, unknown>)?.mpin
  if (typeof mpin !== 'string' || !mpin.trim()) throw new HttpError(400, "Field 'mpin' is required", 'VALIDATION')
  const row = await getConnectionRow(userId)
  if (!row) throw new HttpError(404, 'No broker connection configured', 'NOT_FOUND')

  const creds = await store.loadCredentials(row.id)
  const fullCreds: BrokerCredentials = { ...creds, mpin: mpin.trim() }
  const adapter = adapterRegistry.getOrCreate('angelone', row.id, persistenceFor(row.id))
  try {
    await adapter.login(fullCreds)
    const profile = await adapter.getProfile()
    await store.saveBrokerProfile(row.id, profile as unknown)
    await store.recordAuditEvent(userId, 'broker.connected', { broker: 'angelone', via: 'reconnect' })
    return { status: 'connected' }
  } catch (err) {
    const isCredError = err instanceof BrokerError && err.kind === 'invalid_credentials'
    await store.updateStatus(row.id, isCredError ? 'invalid_credentials' : 'token_expired', (err as Error).message)
    await store.recordAuditEvent(userId, 'broker.connect_failed', { mode: 'reconnect', reason: (err as Error).message })
    throw err
  }
}

/** Disconnect (spec 3.2): clear tokens, keep credentials + all history. */
export async function disconnect(userId: string): Promise<{ status: ConnectionStatus }> {
  const row = await getConnectionRow(userId)
  if (!row) throw new HttpError(404, 'No broker connection configured', 'NOT_FOUND')
  const adapter = adapterRegistry.get(row.id)
  await adapter?.logout().catch(() => undefined)
  adapterRegistry.evict(row.id)
  await store.disconnect(row.id)
  await store.recordAuditEvent(userId, 'broker.disconnected', { broker: row.broker })
  return { status: 'disconnected' }
}

/** Remove entirely: deletes the connection row incl. encrypted credentials. */
export async function remove(userId: string): Promise<{ status: 'not_configured' }> {
  const row = await getConnectionRow(userId)
  if (!row) return { status: 'not_configured' }
  const adapter = adapterRegistry.get(row.id)
  await adapter?.logout().catch(() => undefined)
  adapterRegistry.evict(row.id)
  await store.removeConnection(row.id, userId)
  await store.recordAuditEvent(userId, 'broker.disconnected', { broker: row.broker, removed: true })
  return { status: 'not_configured' }
}

export interface TokenRefreshSummary {
  total: number
  refreshed: number
  markedExpired: number
  transientFailures: number
}

/**
 * §3.9 trigger "broker token expired / re-login failed". Every call site is a
 * genuine "automatic recovery failed / session unusable" determination; a
 * per-connection cooldown (in-memory, 6h) keeps a stuck connection from
 * spamming the user on every cron sweep / API attempt.
 */
const tokenExpiredNotifiedAt = new Map<string, number>()
const TOKEN_EXPIRED_NOTIFY_COOLDOWN_MS = 6 * 60 * 60_000

async function notifyTokenExpired(connectionId: string, userId: string, reason: string): Promise<void> {
  const last = tokenExpiredNotifiedAt.get(connectionId) ?? 0
  if (Date.now() - last < TOKEN_EXPIRED_NOTIFY_COOLDOWN_MS) return
  tokenExpiredNotifiedAt.set(connectionId, Date.now())
  await notify(
    userId,
    'token_expired',
    'Broker token expired — reconnect required',
    `Automatic re-login failed (${reason}). Reconnect with your MPIN on the Broker page to resume live data and trading.`,
  )
}

/**
 * Build a session-bound adapter for a user's Angel One connection (used by the
 * backtest/live engines' REST calls). Restores DB tokens into the registry;
 * the adapter's AG8001 recovery refreshes via the stored refresh token when
 * the trading-day token is stale. Throws BROKER_NOT_CONNECTED when absent.
 */
export async function getSessionAdapterForUser(userId: string): Promise<{
  adapter: ReturnType<typeof adapterRegistry.getOrCreate>
  connectionId: string
}> {
  const row = await getConnectionRow(userId)
  if (!row) {
    throw new HttpError(400, 'Connect your Angel One broker on the Broker page first', 'BROKER_NOT_CONNECTED')
  }
  const stored = await store.loadSession(row.id)
  if (!stored?.jwtToken) {
    await store.updateStatus(row.id, 'token_expired', 'No live session — reconnect with your MPIN')
    await notifyTokenExpired(row.id, row.user_id, 'no live session')
    throw new HttpError(400, 'Broker session is not active — reconnect on the Broker page', 'BROKER_NOT_CONNECTED')
  }
  const creds = await store.loadCredentials(row.id)
  const adapter = adapterRegistry.getOrCreate('angelone', row.id, persistenceFor(row.id))
  adapter.useSession(stored, creds.apiKey)
  return { adapter, connectionId: row.id }
}

/**
 * Daily pre-market job (spec 3.2 refreshSession, 08:00 IST cron): mint fresh
 * trading-day tokens for every connection via the refresh token. Connections
 * whose refresh token is stale are marked token_expired + audited (the UI then
 * prompts the user to reconnect with their MPIN, and the §3.9 token_expired notification fires).
 */
export async function refreshAllConnections(): Promise<TokenRefreshSummary> {
  const rows = await store.getAllConnections()
  const summary: TokenRefreshSummary = { total: rows.length, refreshed: 0, markedExpired: 0, transientFailures: 0 }

  for (const row of rows) {
    if (!row.refresh_token) {
      if (row.status !== 'disconnected' && row.status !== 'invalid_credentials') {
        await store.updateStatus(row.id, 'token_expired', 'No stored session; reconnect with your MPIN')
        await notifyTokenExpired(row.id, row.user_id, 'no stored session')
        summary.markedExpired++
      }
      continue
    }
    try {
      const creds = await store.loadCredentials(row.id)
      const adapter = adapterRegistry.getOrCreate('angelone', row.id, persistenceFor(row.id))
      adapter.useSession(
        {
          jwtToken: row.jwt_token ?? '',
          refreshToken: row.refresh_token,
          feedToken: row.feed_token ?? '',
          expiresAt: row.token_expiry ? new Date(row.token_expiry) : new Date(0),
        },
        creds.apiKey,
      )
      await adapter.refreshSession(row.refresh_token) // applySession persists tokens + 'connected'
      await store.recordAuditEvent(row.user_id, 'broker.token_refreshed', { broker: row.broker })
      summary.refreshed++
    } catch (err) {
      const isStale =
        err instanceof BrokerError && (err.kind === 'session_expired' || err.kind === 'invalid_credentials')
      if (isStale) {
        await store.updateStatus(row.id, 'token_expired', (err as Error).message)
        await store.recordAuditEvent(row.user_id, 'broker.token_expired', { reason: (err as Error).message })
        await notifyTokenExpired(row.id, row.user_id, (err as Error).message)
        summary.markedExpired++
      } else {
        // Network/rate-limit issues: leave status alone, next cron run retries.
        logger.warn('token refresh transient failure', { connectionId: row.id, error: (err as Error).message })
        summary.transientFailures++
      }
    }
  }

  logger.info('token refresh job completed', { ...summary })
  return summary
}
