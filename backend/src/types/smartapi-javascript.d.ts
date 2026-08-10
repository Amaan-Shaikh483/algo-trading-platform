/**
 * Type declarations for the untyped `smartapi-javascript` package (v1.0.27).
 * Signatures verified against the official GitHub source:
 *   - lib/smartapi-connect.js (REST client)
 *   - lib/websocket2.0.js     (WebSocketV2 market feed)
 *   - lib/index.js            (exports)
 * https://github.com/angel-one/smartapi-javascript
 */

declare module 'smartapi-javascript' {
  export interface SmartApiConstructorParams {
    api_key: string
    totp?: string
    client_code?: string
    root?: string
    timeout?: number
    debug?: boolean
    access_token?: string
    refresh_token?: string
  }

  /** Standard SmartAPI response envelope. On failure `status` is false and `errorcode`/`message` describe why. */
  export interface SmartApiResponse<T = unknown> {
    status: boolean
    message: string
    errorcode: string
    data: T
  }

  export interface SessionData {
    jwtToken: string
    refreshToken: string
    /** NOTE: SmartAPI returns this key as `feedtoken` (all lowercase). */
    feedtoken: string
  }

  export interface PlaceOrderParams {
    variety: 'NORMAL' | 'STOPLOSS' | 'AMO' | 'ROBO'
    tradingsymbol: string
    symboltoken: string
    transactiontype: 'BUY' | 'SELL'
    exchange: 'NSE' | 'BSE' | 'NFO' | 'MCX' | 'BFO' | 'CDS'
    ordertype: 'MARKET' | 'LIMIT' | 'STOPLOSS_LIMIT' | 'STOPLOSS_MARKET'
    producttype: 'DELIVERY' | 'CARRYFORWARD' | 'MARGIN' | 'INTRADAY' | 'BO'
    duration: 'DAY' | 'IOC'
    price?: string | number
    triggerprice?: string | number
    squareoff?: string | number
    stoploss?: string | number
    trailingStopLoss?: string | number
    disclosedquantity?: string | number
    quantity: string | number
    ordertag?: string
  }

  export interface ModifyOrderParams extends Partial<PlaceOrderParams> {
    orderid: string
    variety: string
  }

  export interface CancelOrderParams {
    variety: string
    orderid: string
  }

  export interface ConvertPositionParams {
    exchange: string
    oldproducttype: string
    newproducttype: string
    tradingsymbol: string
    symboltoken: string
    transactiontype: 'BUY' | 'SELL'
    instrumenttype?: string
    quantity: number | string
    type: 'DAY' | 'NET'
  }

  export interface GttRuleParams {
    tradingsymbol: string
    symboltoken: string
    exchange: string
    producttype: string
    transactiontype: 'BUY' | 'SELL'
    price: number
    qty: number
    disclosedqty?: number
    triggerprice: number
    timeperiod: number
  }

  export interface MarketDataParams {
    mode: 'LTP' | 'OHLC' | 'FULL'
    exchangeTokens: Record<string, string[]>
  }

  export interface SearchScripParams {
    exchange: string
    searchscrip: string
  }

  export interface CandleDataParams {
    exchange: string
    symboltoken: string
    /** e.g. ONE_MINUTE, THREE_MINUTE, FIVE_MINUTE, TEN_MINUTE, FIFTEEN_MINUTE, THIRTY_MINUTE, ONE_HOUR, ONE_DAY */
    interval: string
    /** Format "YYYY-MM-DD HH:mm" (IST) */
    fromdate: string
    /** Format "YYYY-MM-DD HH:mm" (IST) */
    todate: string
  }

  /** Historical API candle row: [timestamp ISO, open, high, low, close, volume] */
  export type CandleRow = [string, number, number, number, number, number]

  export interface MarginPosition {
    exchange: string
    qty: number
    price: number
    productType: string
    token: string
    tradeType: 'BUY' | 'SELL'
  }

  export class SmartAPI {
    constructor(params: SmartApiConstructorParams)
    access_token: string | null
    refresh_token: string | null

    setAccessToken(accessToken: string): void
    setPublicToken(refreshToken: string): void
    setClientCode(clientCode: string): void
    setSessionExpiryHook(cb: () => void): void

    generateSession(clientCode: string, password: string, totp: string): Promise<SmartApiResponse<SessionData>>
    generateToken(refreshToken: string): Promise<SmartApiResponse<SessionData>>
    logout(clientCode: string): Promise<SmartApiResponse<unknown> | { status: number; message: string }>
    getProfile(): Promise<SmartApiResponse<unknown>>

    placeOrder(params: PlaceOrderParams): Promise<SmartApiResponse<{ orderid: string; uniqueorderid?: string }>>
    modifyOrder(params: ModifyOrderParams): Promise<SmartApiResponse<{ orderid: string }>>
    cancelOrder(params: CancelOrderParams): Promise<SmartApiResponse<{ orderid: string }>>
    getOrderBook(): Promise<SmartApiResponse<unknown[]>>
    getTradeBook(): Promise<SmartApiResponse<unknown[]>>
    indOrderDetails(qParams: string): Promise<SmartApiResponse<unknown>>

    getRMS(): Promise<SmartApiResponse<unknown>>
    getHolding(): Promise<SmartApiResponse<unknown[]>>
    getAllHolding(): Promise<SmartApiResponse<unknown>>
    getPosition(): Promise<SmartApiResponse<unknown[]>>
    convertPosition(params: ConvertPositionParams): Promise<SmartApiResponse<unknown>>

    createRule(params: GttRuleParams): Promise<SmartApiResponse<unknown>>
    modifyRule(params: { id: number; symboltoken: string; exchange: string; qty: number }): Promise<SmartApiResponse<unknown>>
    cancelRule(params: { id: number; symboltoken: string; exchange: string }): Promise<SmartApiResponse<unknown>>
    ruleDetails(params: { id: number }): Promise<SmartApiResponse<unknown>>
    ruleList(params: { status: string[]; page: number; count: number }): Promise<SmartApiResponse<unknown> | { status: number; message: string }>

    marketData(params: MarketDataParams): Promise<SmartApiResponse<unknown>>
    searchScrip(params: SearchScripParams): Promise<unknown>
    marginApi(params: { positions: MarginPosition[] }): Promise<SmartApiResponse<unknown>>
    getCandleData(params: CandleDataParams): Promise<SmartApiResponse<CandleRow[]>>
    getOIData(params: unknown): Promise<SmartApiResponse<unknown>>
  }

  export interface WebSocketV2Params {
    jwttoken: string
    apikey: string
    clientcode: string
    /** The SmartAPI feed token. */
    feedtype: string
  }

  export interface WsSubscriptionRequest {
    correlationID?: string
    /** 1 = Subscribe, 0 = Unsubscribe (WS_ACTION) */
    action: number
    /** 1 = LTP, 2 = Quote, 3 = SnapQuote, 4 = Depth (WS_MODE) */
    mode: number
    /** 1 = nse_cm, 2 = nse_fo, 3 = bse_cm, 4 = bse_fo, 5 = mcx_fo, 7 = ncx_fo, 13 = cde_fo (WS_EXCHANGE) */
    exchangeType: number
    tokens: string[]
  }

  export interface LtpTick {
    subscription_mode: number
    exchange_type: number
    /** Scrip token (trailing null-bytes stripped by the SDK parser) */
    token: string
    sequence_number: number
    exchange_timestamp: number
    /** Price in paise — divide by 100 for INR. */
    last_traded_price: number
  }

  /** Market data WebSocket (SmartAPI SmartStream). Emits 'tick' decoded per subscribed mode. */
  export class WebSocketV2 {
    constructor(params: WebSocketV2Params)
    connect(): Promise<void>
    fetchData(jsonReq: WsSubscriptionRequest): void
    on(event: 'tick' | 'connect', callback: (data: unknown) => void): void
    close(): void
    customError(): void
    /** Built-in reconnect: type 'simple' | 'exponential'. */
    reconnection(type: 'simple' | 'exponential', delTime: number, multiplier?: number): void
  }

  /** Order-update WebSocket (order feed). */
  export class WebSocketClient {
    constructor(params: { clientcode: string; jwttoken: string; apikey: string; feedtype: string })
    connect(): Promise<void>
    fetchData(actionType: string, feedType: string): void
    on(event: 'tick', callback: (data: unknown) => void): void
    close(): void
  }

  /** Legacy v1 market-data websocket (superseded by WebSocketV2). */
  export class WebSocket {
    constructor(params: { client_code: string; feed_token: string })
    connect(): Promise<void>
    runScript(script: string, task: string): void
    on(event: 'tick', callback: (data: unknown) => void): void
    close(): void
  }

  export class WSOrderUpdates {
    constructor(params: { jwttoken: string; apikey: string; clientcode: string })
    connect(): Promise<void>
    on(event: 'tick', callback: (data: unknown) => void): void
    close(): void
  }
}
