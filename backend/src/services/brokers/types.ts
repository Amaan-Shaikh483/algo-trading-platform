/**
 * Generic broker abstraction (spec 3.2 "multi-broker ready design").
 * The trading engine only ever talks to the `BrokerAdapter` interface, so a
 * second broker can be added later by implementing it — no engine rewrites.
 */

export type BrokerId = 'angelone' // | 'zerodha' | 'upstox' … future

export type ConnectionStatus =
  | 'connected'
  | 'token_expired'
  | 'disconnected'
  | 'invalid_credentials'

export interface BrokerCredentials {
  apiKey: string
  clientCode: string
  /** MPIN — used for login only. NEVER persisted anywhere (spec 3.1). */
  mpin?: string
  /** Base32 TOTP secret (decrypted form). */
  totpSecret?: string
}

export interface BrokerSession {
  jwtToken: string
  refreshToken: string
  feedToken: string
  /** When the JWT stops being accepted (SmartAPI tokens are valid for the trading day). */
  expiresAt: Date
}

// ── Normalized order DTOs (broker-agnostic vocabulary) ──────────────────────

export type Exchange = 'NSE' | 'BSE' | 'NFO' | 'MCX' | 'BFO' | 'CDS'
export type TransactionType = 'BUY' | 'SELL'
export type OrderType = 'MARKET' | 'LIMIT' | 'STOPLOSS_LIMIT' | 'STOPLOSS_MARKET'
export type ProductType = 'DELIVERY' | 'CARRYFORWARD' | 'MARGIN' | 'INTRADAY' | 'BO'
/** Docs (Orders → Order Constants): variety is NORMAL, STOPLOSS or ROBO. (No AMO in SmartAPI.) */
export type OrderVariety = 'NORMAL' | 'STOPLOSS' | 'ROBO'
export type OrderDuration = 'DAY' | 'IOC'

export interface PlaceOrderInput {
  variety: OrderVariety
  tradingsymbol: string
  symboltoken: string
  transactiontype: TransactionType
  exchange: Exchange
  ordertype: OrderType
  producttype: ProductType
  duration: OrderDuration
  quantity: number
  price?: number
  triggerprice?: number
  /** Free-form tag; SmartAPI persists this on the order for reconciliation. */
  ordertag?: string
}

export interface ModifyOrderInput extends Omit<Partial<PlaceOrderInput>, 'variety'> {
  orderid: string
  /** SmartAPI requires variety to modify; accepts any variety string. */
  variety: string
}

export interface PlacedOrder {
  brokerOrderId: string
  uniqueOrderId?: string
}

export type BrokerOrderStatus =
  | 'pending'
  | 'open'
  | 'complete'
  | 'cancelled'
  | 'rejected'
  | 'unknown'

export interface BrokerOrder {
  brokerOrderId: string
  status: BrokerOrderStatus
  rawStatus: string
  tradingsymbol: string
  symboltoken: string
  exchange: string
  transactiontype: string
  ordertype: string
  producttype: string
  quantity: number
  /** Filled quantity (from the broker fill, may be < quantity for partial fills). */
  filledQuantity: number
  price: number
  /** Average traded price. */
  averagePrice: number
  rejectionReason?: string
  placedAt?: string
  /** Original broker payload, retained for debugging/reconciliation. */
  raw: unknown
}

export interface BrokerPosition {
  tradingsymbol: string
  symboltoken: string
  exchange: string
  producttype: string
  /** Net quantity (+ long / − short). */
  netQuantity: number
  averagePrice: number
  lastTradedPrice: number
  pnl: number
  raw: unknown
}

export interface BrokerHolding {
  tradingsymbol: string
  symboltoken: string
  exchange: string
  quantity: number
  averagePrice: number
  lastTradedPrice: number
  pnl: number
  raw: unknown
}

export interface BrokerFunds {
  availableCash: number
  availableMargin: number
  usedMargin: number
  raw: unknown
}

export interface BrokerProfile {
  clientCode: string
  name: string
  email?: string
  mobile?: string
  exchanges: string[]
  products: string[]
  raw: unknown
}

export interface CandleInput {
  exchange: Exchange
  symboltoken: string
  /** Engine vocabulary: '1m' | '3m' | '5m' | '10m' | '15m' | '30m' | '1h' | '1D' */
  interval: string
  from: Date
  to: Date
}

export type OptionContractType = 'CE' | 'PE'
export type OptionDataSource = 'market' | 'synthetic'

/**
 * A single contract snapshot attached to an underlying candle during an
 * options backtest. `open`/`high`/`low`/`close` are OPTION PREMIUM prices, not
 * underlying prices. Maps are keyed by `contractId` (not strike alone), since
 * CE and PE contracts can share a strike and expiry.
 */
export interface OptionChainData {
  contractId: string
  source: OptionDataSource
  underlying: number
  strike: number
  optionType: OptionContractType
  expiryType: 'WEEKLY' | 'MONTHLY'
  expiry: Date
  premium: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  delta: number
  gamma: number
  /** Vega per one percentage-point change in volatility. */
  vega: number
  /** Theta per calendar day. */
  theta: number
  impliedVol: number
  timeToExpiry: number
}

export interface Candle {
  time: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
  /** Optional option contracts aligned to this underlying bar. */
  optionChains?: ReadonlyMap<string, OptionChainData>
}

export interface LtpQuote {
  exchange: string
  tradingsymbol: string
  symboltoken: string
  ltp: number
  open?: number
  high?: number
  low?: number
  close?: number
}

// ── Error model ─────────────────────────────────────────────────────────────

export type BrokerErrorKind =
  | 'session_expired' // token invalid/expired (e.g. SmartAPI AG8001)
  | 'invalid_credentials' // bad MPIN/TOTP/API key at login
  | 'rejected' // order rejected by broker/exchange
  | 'rate_limited'
  | 'network'
  | 'unknown'

export class BrokerError extends Error {
  constructor(
    message: string,
    public readonly kind: BrokerErrorKind,
    public readonly brokerCode?: string,
    public readonly raw?: unknown,
  ) {
    super(message)
    this.name = 'BrokerError'
  }
}

// ── Live market feed handle (WebSocket) ─────────────────────────────────────

export interface MarketFeedSubscribe {
  exchangeType: number // SmartAPI exchange type (1=nse_cm …) — kept numeric for v1; abstract later
  tokens: string[]
  /** 1=LTP, 2=Quote (LTP + last-traded-qty + day OHLC/volume), 3=SnapQuote, 4=Depth. Default 1. */
  mode?: number
}

export interface MarketFeed {
  connect(): Promise<void>
  subscribeLtp(items: MarketFeedSubscribe[]): void
  unsubscribe(items: MarketFeedSubscribe[]): void
  onTick(cb: (tick: unknown) => void): void
  close(): void
}

/**
 * Session-lifecycle hooks so the persistence layer (broker_connections table,
 * wired in the next milestone) stays decoupled from the SmartAPI wrapper.
 */
export interface SessionPersistence {
  persistSession(connectionId: string, session: BrokerSession): Promise<void>
  updateStatus(connectionId: string, status: ConnectionStatus, lastError?: string): Promise<void>
  /** Supplies + applies fresh credentials for the one-shot auto re-login on token expiry. Returns null if unavailable. */
  reauthenticate?(connectionId: string): Promise<BrokerSession | null>
}

export interface BrokerAdapter {
  readonly broker: BrokerId

  /** Authenticate with API key + client code + MPIN + TOTP and return a live session. */
  login(credentials: BrokerCredentials): Promise<BrokerSession>
  /** Exchange a stored refresh token for a fresh session (no MPIN needed). */
  refreshSession(refreshToken: string): Promise<BrokerSession>
  logout(): Promise<void>
  getProfile(): Promise<BrokerProfile>

  placeOrder(params: PlaceOrderInput): Promise<PlacedOrder>
  modifyOrder(params: ModifyOrderInput): Promise<void>
  cancelOrder(orderId: string, variety: string): Promise<void>
  getOrderBook(): Promise<BrokerOrder[]>
  getTradeBook(): Promise<BrokerOrder[]>
  getOrderDetails(brokerOrderId: string): Promise<BrokerOrder | null>

  getPositions(): Promise<BrokerPosition[]>
  getHoldings(): Promise<BrokerHolding[]>
  getRMS(): Promise<BrokerFunds>

  getCandleData(params: CandleInput): Promise<Candle[]>
  /** Quote snapshots. mode 'LTP' (cheap) | 'OHLC' | 'FULL' (adds prev-day OHLC for change%). */
  getLTP(exchangeTokens: Record<string, string[]>, mode?: 'LTP' | 'OHLC' | 'FULL'): Promise<LtpQuote[]>

  /** Live tick stream (SmartAPI WebSocket V2). */
  createMarketFeed(): MarketFeed

  /** Attach an existing session (e.g. restored from the DB at process start). */
  useSession(session: BrokerSession, apiKey?: string): void
  /** Called when SmartAPI reports session invalid (AG8001) — registered by the session manager. */
  onSessionExpired(cb: () => void): void
}
