/**
 * Angel One SmartAPI adapter (spec 3.2 backend service).
 *
 * A thin, verified wrapper around the official `smartapi-javascript` SDK
 * (v1.0.27) — every method name and payload shape below was cross-checked
 * against https://github.com/angel-one/smartapi-javascript (lib/smartapi-connect.js,
 * lib/websocket2.0.js) rather than assumed.
 *
 * Responsibilities:
 *   - login / generateSession with on-the-fly TOTP (otplib)
 *   - refreshSession (daily pre-market re-login support)
 *   - order placement/modify/cancel, order book, trade book, order details
 *   - positions, holdings, RMS funds
 *   - historical candles (getCandleData), LTP quotes (marketData)
 *   - live market feed factory (WebSocketV2) with reconnect-with-backoff
 *   - rate limiting per spec 2.2 (Bottleneck)
 *   - session-expiry (AG8001) handling: mark Token Expired, one-shot
 *     re-login + single retry, then surface the failure for user notification
 *
 * This module contains NO strategy/order-decision logic — the Risk Manager
 * (spec 3.7, build step 9) gates every order before it ever reaches placeOrder.
 */
import { SmartAPI, WebSocketV2, WebSocketClient } from 'smartapi-javascript'
import type { SmartApiResponse, CandleRow } from 'smartapi-javascript'
import { generateTotp } from '../../lib/totp'
import { logger } from '../../lib/logger'
import {
  tradingLimiter,
  tradingMinuteLimiter,
  marketDataLimiter,
  historicalLimiter,
  historicalMinuteLimiter,
  historicalHourLimiter,
  portfolioLimiter,
  generalLimiter,
} from '../../lib/rateLimiter'
import type Bottleneck from 'bottleneck'
import type {
  BrokerAdapter,
  BrokerCredentials,
  BrokerErrorKind,
  BrokerFunds,
  BrokerHolding,
  BrokerOrder,
  BrokerPosition,
  BrokerProfile,
  BrokerSession,
  Candle,
  CandleInput,
  LtpQuote,
  MarketFeed,
  MarketFeedSubscribe,
  ModifyOrderInput,
  PlaceOrderInput,
  PlacedOrder,
  SessionPersistence,
} from './types'
import { BrokerError } from './types'

/** Engine interval vocabulary → SmartAPI Historical API interval strings (verified against docs). */
const INTERVAL_MAP: Record<string, string> = {
  '1m': 'ONE_MINUTE',
  '3m': 'THREE_MINUTE',
  '5m': 'FIVE_MINUTE',
  '10m': 'TEN_MINUTE',
  '15m': 'FIFTEEN_MINUTE',
  '30m': 'THIRTY_MINUTE',
  '1h': 'ONE_HOUR',
  '1D': 'ONE_DAY',
}

/** SmartAPI websocket v2 subscription constants (config/constant.js). */
const WS_ACTION = { Subscribe: 1, Unsubscribe: 0 } as const
const WS_MODE = { LTP: 1, Quote: 2, SnapQuote: 3, Depth: 4 } as const

/** Format a Date as "YYYY-MM-DD HH:mm" in IST — the Historical API's expected input. */
export function formatCandleDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/**
 * SmartAPI token/session error codes (official Error Codes doc):
 *   AG8001 Invalid Token · AG8002 Token Expired · AG8003 Token missing.
 * All three mean "this JWT is unusable" → the session-recovery path handles them.
 * (AB8050/AB8051 — invalid/expired *refresh* token — surface through the
 * refreshSession failure branch, which already maps to session_expired.)
 */
export const SESSION_ERROR_CODES: ReadonlySet<string> = new Set(['AG8001', 'AG8002', 'AG8003'])

/** Docs (Live Market Data API): at most 50 tokens per marketData request, across all exchanges. */
export const MARKET_DATA_MAX_TOKENS_PER_REQUEST = 50

/**
 * Split {exchange: tokens[]} into request-sized chunks of ≤ maxPerRequest
 * total tokens, preserving exchange grouping. Pure — unit-tested.
 */
export function splitExchangeTokens(
  exchangeTokens: Record<string, string[]>,
  maxPerRequest = MARKET_DATA_MAX_TOKENS_PER_REQUEST,
): Array<Record<string, string[]>> {
  const chunks: Array<Record<string, string[]>> = []
  let current: Record<string, string[]> = {}
  let size = 0
  const flush = () => {
    if (size > 0) {
      chunks.push(current)
      current = {}
      size = 0
    }
  }
  for (const [exchange, tokens] of Object.entries(exchangeTokens)) {
    for (const token of tokens) {
      if (size >= maxPerRequest) flush()
      ;(current[exchange] ??= []).push(token)
      size++
    }
  }
  flush()
  return chunks
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown): string => (v == null ? '' : String(v))

/** SmartAPI tokens are valid for the trading day; the daily 08:00 IST re-login (spec 3.2) supersedes precise expiry modeling. */
function sessionExpiry(): Date {
  return new Date(Date.now() + 14 * 60 * 60 * 1000)
}

type Envelope = SmartApiResponse<unknown> | { status: number; message: string } | unknown

export class AngelOneAdapter implements BrokerAdapter {
  readonly broker = 'angelone' as const

  private smart: SmartAPI
  private session: BrokerSession | null = null
  private apiKey: string | null = null
  private sessionExpiredCallbacks: Array<() => void> = []
  private reauthInFlight: Promise<BrokerSession> | null = null
  /** In-memory refresh credentials (never logged, never persisted) enabling the one-shot auto re-login. */
  private reauthCredentials: Pick<BrokerCredentials, 'apiKey' | 'clientCode' | 'totpSecret'> | null = null

  constructor(
    private readonly connectionId: string,
    private readonly persistence?: SessionPersistence,
  ) {
    // Placeholder instance; replaced with an api_key-bound instance on login/refresh.
    this.smart = new SmartAPI({ api_key: '' })
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────

  async login(credentials: BrokerCredentials): Promise<BrokerSession> {
    if (!credentials.mpin) throw new BrokerError('MPIN is required for login', 'invalid_credentials')
    if (!credentials.totpSecret) throw new BrokerError('TOTP secret is required for login', 'invalid_credentials')

    this.apiKey = credentials.apiKey
    this.smart = new SmartAPI({ api_key: credentials.apiKey, client_code: credentials.clientCode })
    this.smart.setSessionExpiryHook(() => this.handleSessionExpired())

    let response: Envelope
    try {
      response = await this.smart.generateSession(
        credentials.clientCode,
        credentials.mpin,
        generateTotp(credentials.totpSecret),
      )
    } catch (err) {
      throw new BrokerError(`SmartAPI login request failed: ${(err as Error).message}`, 'network', undefined, err)
    }

    const env_ = response as SmartApiResponse<{ jwtToken: string; refreshToken: string; feedtoken?: string; feedToken?: string }>
    if (!env_ || env_.status !== true || !env_.data?.jwtToken) {
      const code = (env_ as SmartApiResponse)?.errorcode || undefined
      const message = (env_ as SmartApiResponse)?.message || 'SmartAPI rejected the login'
      // Login failures are credential problems by definition (bad MPIN / TOTP / API key).
      throw new BrokerError(message, 'invalid_credentials', code, env_)
    }

    return this.applySession({
      jwtToken: env_.data.jwtToken,
      refreshToken: env_.data.refreshToken,
      feedToken: env_.data.feedtoken ?? env_.data.feedToken ?? '',
      expiresAt: sessionExpiry(),
    }, credentials)
  }

  async refreshSession(refreshToken: string): Promise<BrokerSession> {
    if (!this.apiKey) throw new BrokerError('Cannot refresh: adapter has no API key (log in first)', 'session_expired')
    let response: Envelope
    try {
      response = await this.smart.generateToken(refreshToken)
    } catch (err) {
      throw new BrokerError(`SmartAPI token refresh failed: ${(err as Error).message}`, 'network', undefined, err)
    }
    const env_ = response as SmartApiResponse<{ jwtToken: string; refreshToken: string; feedtoken?: string; feedToken?: string }>
    if (!env_ || env_.status !== true || !env_.data?.jwtToken) {
      throw new BrokerError((env_ as SmartApiResponse)?.message || 'Token refresh rejected', 'session_expired', (env_ as SmartApiResponse)?.errorcode || undefined, env_)
    }
    return this.applySession({
      jwtToken: env_.data.jwtToken,
      refreshToken: env_.data.refreshToken,
      feedToken: env_.data.feedtoken ?? env_.data.feedToken ?? '',
      expiresAt: sessionExpiry(),
    })
  }

  useSession(session: BrokerSession, apiKey?: string): void {
    this.session = session
    if (apiKey) this.apiKey = apiKey
    if (this.apiKey) {
      this.smart = new SmartAPI({
        api_key: this.apiKey,
        access_token: session.jwtToken,
        refresh_token: session.refreshToken,
      })
      this.smart.setSessionExpiryHook(() => this.handleSessionExpired())
    }
  }

  onSessionExpired(cb: () => void): void {
    this.sessionExpiredCallbacks.push(cb)
  }

  async logout(): Promise<void> {
    if (!this.session) return
    try {
      await this.smart.logout(this.smartClientCode() ?? '')
    } finally {
      this.session = null
    }
  }

  private smartClientCode(): string | null {
    return (this.smart as unknown as { client_code?: string }).client_code ?? null
  }

  private async applySession(session: BrokerSession, creds?: BrokerCredentials): Promise<BrokerSession> {
    this.session = session
    this.useSession(session)
    if (creds?.totpSecret) {
      this.reauthCredentials = { apiKey: creds.apiKey, clientCode: creds.clientCode, totpSecret: creds.totpSecret }
    }
    await this.persistence?.persistSession(this.connectionId, session)
    return session
  }

  /**
   * Spec 3.2: on token-invalid (AG8001), mark the connection Token Expired,
   * attempt ONE re-login, and if it still fails surface the error so the user
   * gets notified. Concurrent triggers share a single in-flight re-login.
   */
  private handleSessionExpired(): void {
    void (async () => {
      logger.warn('SmartAPI session expired', { connectionId: this.connectionId })
      await this.persistence?.updateStatus(this.connectionId, 'token_expired', 'SmartAPI rejected the access token (AG8001)')
      try {
        await this.reauthenticateOnce()
      } catch (err) {
        logger.error('Auto re-login after session expiry failed', { connectionId: this.connectionId, error: (err as Error).message })
        // Status stays token_expired; the user is alerted by the token_expired notification fired from persistenceFor.reauthenticate.
      }
    })()
    for (const cb of this.sessionExpiredCallbacks) cb()
  }

  private async reauthenticateOnce(): Promise<BrokerSession> {
    if (this.reauthInFlight) return this.reauthInFlight
    this.reauthInFlight = (async () => {
      const fromPersistence = this.persistence?.reauthenticate
        ? await this.persistence.reauthenticate(this.connectionId)
        : null
      if (fromPersistence) {
        this.useSession(fromPersistence)
        return fromPersistence
      }
      if (!this.reauthCredentials) {
        throw new BrokerError('No credentials available for automatic re-login', 'session_expired')
      }
      // TOTP re-login (MPIN is never stored; Angel also accepts MPIN-less refresh via generateToken, tried first).
      try {
        if (this.session?.refreshToken) return await this.refreshSession(this.session.refreshToken)
        throw new BrokerError('No refresh token', 'session_expired')
      } catch {
        throw new BrokerError(
          'Automatic re-login requires the MPIN, which is never stored. Please reconnect the broker.',
          'session_expired',
        )
      }
    })().finally(() => {
      this.reauthInFlight = null
    })
    return this.reauthInFlight
  }

  // ── API plumbing ──────────────────────────────────────────────────────────

  private requireSession(): void {
    if (!this.session) throw new BrokerError('Not logged in to Angel One', 'session_expired')
  }

  /** Unwrap the SmartAPI envelope, mapping failures onto BrokerError kinds. */
  private unwrap<T>(response: Envelope, defaultKind: BrokerErrorKind): T {
    const res = response as SmartApiResponse<T> & { status: unknown }
    // SDK error interceptor returns { status: <http code number>, message } on HTTP failures.
    if (typeof res?.status === 'number') {
      const code = res.status
      throw new BrokerError(
        `SmartAPI HTTP ${code}: ${(res as { message?: string }).message ?? 'request failed'}`,
        code === 429 ? 'rate_limited' : 'network',
        String(code),
        res,
      )
    }
    if (res && typeof res.status === 'boolean') {
      if (res.status === true) return res.data as T
      const code = (res as { errorcode?: string }).errorcode
      const message = (res as { message?: string }).message || 'SmartAPI error'
      if (code && SESSION_ERROR_CODES.has(code)) throw new BrokerError(message, 'session_expired', code, res)
      throw new BrokerError(message, defaultKind, code, res)
    }
    // SDK interceptor swallows some transport failures and returns [] or {} —
    // those are transport/session problems, not "unexpected shapes".
    if ((Array.isArray(response) && response.length === 0) || (typeof response === 'object' && response && Object.keys(response).length === 0)) {
      throw new BrokerError(
        'SmartAPI request failed before a response was received (network error or dead session; if this repeats, reconnect the broker)',
        'network',
        undefined,
        response,
      )
    }
    const preview = (() => {
      try {
        return JSON.stringify(response)?.slice(0, 120)
      } catch {
        return String(response)
      }
    })()
    throw new BrokerError(`Unexpected SmartAPI response shape: ${preview}`, 'unknown', undefined, response)
  }

  /** Rate-limit + unwrap + session recovery with a single retry after re-login. */
  private async call<T>(
    limiter: Bottleneck,
    fn: () => Promise<Envelope>,
    defaultKind: BrokerErrorKind,
    isRetryAfterReauth = false,
  ): Promise<T> {
    this.requireSession()
    try {
      const response = await limiter.schedule(fn)
      return this.unwrap<T>(response, defaultKind)
    } catch (err) {
      if (err instanceof BrokerError && err.kind === 'session_expired' && !isRetryAfterReauth) {
        this.handleSessionExpired()
        await this.reauthenticateOnce()
        return this.call(limiter, fn, defaultKind, true)
      }
      throw err
    }
  }

  // ── Profile / funds ───────────────────────────────────────────────────────

  async getProfile(): Promise<BrokerProfile> {
    const data = await this.call<Record<string, unknown>>(generalLimiter, () => this.smart.getProfile(), 'unknown')
    return {
      clientCode: str(data?.clientcode),
      name: str(data?.name),
      email: data?.email ? str(data.email) : undefined,
      mobile: data?.mobileno ? str(data.mobileno) : undefined,
      exchanges: Array.isArray(data?.exchanges) ? (data.exchanges as string[]).map(String) : [],
      products: Array.isArray(data?.products) ? (data.products as string[]).map(String) : [],
      raw: data,
    }
  }

  async getRMS(): Promise<BrokerFunds> {
    const data = await this.call<Record<string, unknown>>(portfolioLimiter, () => this.smart.getRMS(), 'unknown')
    return {
      availableCash: num(data?.availablecash ?? data?.net),
      availableMargin: num(data?.availableintradaypayin ?? data?.availablelimitmargin),
      usedMargin: num(data?.utiliseddebits),
      raw: data,
    }
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  async placeOrder(params: PlaceOrderInput): Promise<PlacedOrder> {
    const payload = {
      variety: params.variety,
      tradingsymbol: params.tradingsymbol,
      symboltoken: params.symboltoken,
      transactiontype: params.transactiontype,
      exchange: params.exchange,
      ordertype: params.ordertype,
      producttype: params.producttype,
      duration: params.duration,
      quantity: params.quantity,
      ...(params.price != null ? { price: params.price } : {}),
      ...(params.triggerprice != null ? { triggerprice: params.triggerprice } : {}),
      ...(params.ordertag ? { ordertag: params.ordertag } : {}),
      squareoff: '0',
      stoploss: '0',
    }
    // Docs: order APIs share a CUMULATIVE 9/sec + 500/min budget across place/modify/cancel —
    // gate through the minute window first, then the per-second trading limiter.
    const data = await tradingMinuteLimiter.schedule(() =>
      this.call<{ orderid?: string; uniqueorderid?: string; script?: string }>(
        tradingLimiter,
        () => this.smart.placeOrder(payload as never),
        'rejected',
      ),
    )
    if (!data?.orderid) throw new BrokerError('SmartAPI did not return an order id', 'unknown', undefined, data)
    return { brokerOrderId: data.orderid, uniqueOrderId: data.uniqueorderid }
  }

  async modifyOrder(params: ModifyOrderInput): Promise<void> {
    const { orderid, variety, ...rest } = params
    await tradingMinuteLimiter.schedule(() =>
      this.call(tradingLimiter, () => this.smart.modifyOrder({ orderid, variety, ...rest } as never), 'rejected'),
    )
  }

  async cancelOrder(orderId: string, variety: string): Promise<void> {
    await tradingMinuteLimiter.schedule(() =>
      this.call(tradingLimiter, () => this.smart.cancelOrder({ orderid: orderId, variety }), 'rejected'),
    )
  }

  // Portfolio read APIs are capped at 1/sec each by the docs → portfolioLimiter.

  async getOrderBook(): Promise<BrokerOrder[]> {
    const data = await this.call<Record<string, unknown>[] | null>(portfolioLimiter, () => this.smart.getOrderBook(), 'unknown')
    return (Array.isArray(data) ? data : []).map((o) => this.mapOrder(o))
  }

  async getTradeBook(): Promise<BrokerOrder[]> {
    const data = await this.call<Record<string, unknown>[] | null>(portfolioLimiter, () => this.smart.getTradeBook(), 'unknown')
    return (Array.isArray(data) ? data : []).map((o) => this.mapOrder({ ...o, status: 'complete' }))
  }

  async getOrderDetails(brokerOrderId: string): Promise<BrokerOrder | null> {
    const data = await this.call<Record<string, unknown> | null>(
      generalLimiter,
      () => this.smart.indOrderDetails(brokerOrderId) as Promise<never>,
      'unknown',
    )
    return data ? this.mapOrder(data) : null
  }

  private mapOrder(o: Record<string, unknown>): BrokerOrder {
    const rawStatus = str(o?.status ?? o?.orderstatus).toLowerCase()
    let status: BrokerOrder['status'] = 'unknown'
    if (rawStatus.includes('complete')) status = 'complete'
    else if (rawStatus.includes('cancel')) status = 'cancelled'
    else if (rawStatus.includes('reject')) status = 'rejected'
    else if (rawStatus.includes('open') || rawStatus.includes('trigger')) status = 'open'
    else if (rawStatus.includes('pending')) status = 'pending'
    return {
      brokerOrderId: str(o?.orderid),
      status,
      rawStatus,
      tradingsymbol: str(o?.tradingsymbol),
      symboltoken: str(o?.symboltoken),
      exchange: str(o?.exchange),
      transactiontype: str(o?.transactiontype),
      ordertype: str(o?.ordertype),
      producttype: str(o?.producttype),
      quantity: num(o?.quantity),
      filledQuantity: num(o?.filledshares),
      price: num(o?.price),
      averagePrice: num(o?.averageprice),
      rejectionReason: o?.text ? str(o.text) : undefined,
      placedAt: o?.updatetime ? str(o.updatetime) : undefined,
      raw: o,
    }
  }

  // ── Portfolio ─────────────────────────────────────────────────────────────

  async getPositions(): Promise<BrokerPosition[]> {
    const data = await this.call<Record<string, unknown>[] | null>(portfolioLimiter, () => this.smart.getPosition(), 'unknown')
    return (Array.isArray(data) ? data : []).map((p) => ({
      tradingsymbol: str(p?.tradingsymbol),
      symboltoken: str(p?.symboltoken),
      exchange: str(p?.exchange),
      producttype: str(p?.producttype),
      netQuantity: num(p?.netqty),
      averagePrice: num(p?.avgnetprice ?? p?.netprice),
      lastTradedPrice: num(p?.ltp),
      pnl: num(p?.pnl),
      raw: p,
    }))
  }

  async getHoldings(): Promise<BrokerHolding[]> {
    const data = await this.call<{ holdings?: Record<string, unknown>[] } | null>(portfolioLimiter, () => this.smart.getAllHolding(), 'unknown')
    const holdings = Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : data?.holdings ?? []
    return holdings.map((h) => ({
      tradingsymbol: str(h?.tradingsymbol),
      symboltoken: str(h?.symboltoken),
      exchange: str(h?.exchange),
      quantity: num(h?.quantity),
      averagePrice: num(h?.averageprice),
      lastTradedPrice: num(h?.ltp),
      pnl: num(h?.pnl ?? h?.profitandloss),
      raw: h,
    }))
  }

  // ── Market data ───────────────────────────────────────────────────────────

  async getLTP(exchangeTokens: Record<string, string[]>, mode: 'LTP' | 'OHLC' | 'FULL' = 'LTP'): Promise<LtpQuote[]> {
    // Docs (Live Market Data API): max 50 tokens per request — split + merge.
    const chunks = splitExchangeTokens(exchangeTokens)
    const fetched: Record<string, unknown>[] = []
    for (const chunk of chunks) {
      const data = await this.call<{ fetched?: Record<string, unknown>[]; unfetched?: unknown[] } | null>(
        marketDataLimiter,
        () => this.smart.marketData({ mode, exchangeTokens: chunk }),
        'unknown',
      )
      fetched.push(...(data?.fetched ?? []))
    }
    return fetched.map((q) => ({
      exchange: str(q?.exchange),
      tradingsymbol: str(q?.tradingSymbol ?? q?.tradingsymbol),
      symboltoken: str(q?.symbolToken ?? q?.symboltoken),
      ltp: num(q?.ltp),
      open: q?.open != null ? num(q.open) : undefined,
      high: q?.high != null ? num(q.high) : undefined,
      low: q?.low != null ? num(q.low) : undefined,
      close: q?.close != null ? num(q.close) : undefined,
    }))
  }

  async getCandleData(params: CandleInput): Promise<Candle[]> {
    const interval = INTERVAL_MAP[params.interval]
    if (!interval) throw new BrokerError(`Unsupported interval '${params.interval}'`, 'unknown')
    // Docs: historical is 3/sec AND 150/min AND 5000/hr — chain the window gates.
    const data = await historicalHourLimiter.schedule(() =>
      historicalMinuteLimiter.schedule(() =>
        this.call<CandleRow[] | null>(
          historicalLimiter,
          () =>
            this.smart.getCandleData({
              exchange: params.exchange,
              symboltoken: params.symboltoken,
              interval,
              fromdate: formatCandleDate(params.from),
              todate: formatCandleDate(params.to),
            }),
          'unknown',
        ),
      ),
    )
    // Historical rows: [ISO timestamp, open, high, low, close, volume]
    return (Array.isArray(data) ? data : []).map((row) => ({
      time: new Date(row[0]),
      open: row[1],
      high: row[2],
      low: row[3],
      close: row[4],
      volume: row[5],
    }))
  }

  // ── Live feed (spec 3.6 foundation; wired to the engine in build step 7) ──

  createMarketFeed(): MarketFeed {
    this.requireSession()
    if (!this.apiKey) throw new BrokerError('API key required to open the market feed', 'unknown')
    const clientCode = this.smartClientCode()
    const ws = new WebSocketV2({
      jwttoken: this.session!.jwtToken,
      apikey: this.apiKey,
      clientcode: clientCode ?? '',
      feedtype: this.session!.feedToken,
    })
    // Spec 2.2: reconnect-with-backoff (SDK-native exponential reconnection).
    ws.reconnection('exponential', 1000, 2)
    // Route WS errors (incl. 401 expired-tokens) to a catchable promise rejection
    // instead of the SDK's throw-inside-callback (verified lib/websocket2.0.js).
    if (typeof ws.customError === 'function') ws.customError()

    return {
      connect: () => ws.connect(),
      subscribeLtp: (items: MarketFeedSubscribe[]) => {
        for (const item of items) {
          if (item.tokens.length > 0) {
            ws.fetchData({ action: WS_ACTION.Subscribe, mode: item.mode ?? WS_MODE.LTP, exchangeType: item.exchangeType, tokens: item.tokens })
          }
        }
      },
      unsubscribe: (items: MarketFeedSubscribe[]) => {
        for (const item of items) {
          if (item.tokens.length > 0) {
            ws.fetchData({ action: WS_ACTION.Unsubscribe, mode: item.mode ?? WS_MODE.LTP, exchangeType: item.exchangeType, tokens: item.tokens })
          }
        }
      },
      onTick: (cb) => ws.on('tick', cb),
      close: () => ws.close(),
    }
  }

  /** Order-update stream (private order feed) — used by the reconciliation/job layer later. */
  createOrderFeed(): WebSocketClient {
    this.requireSession()
    return new WebSocketClient({
      clientcode: this.smartClientCode() ?? '',
      jwttoken: this.session!.jwtToken,
      apikey: this.apiKey ?? '',
      feedtype: 'order_feed',
    })
  }
}

export function createAngelOneAdapter(connectionId: string, persistence?: SessionPersistence): AngelOneAdapter {
  return new AngelOneAdapter(connectionId, persistence)
}
