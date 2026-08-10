/** HTTP error with a client-safe message and machine-readable code. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** Maps thrown errors (incl. BrokerError kinds) onto HTTP responses. */
export function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err
  const e = err as { name?: string; kind?: string; message?: string }
  if (e?.name === 'BrokerError') {
    switch (e.kind) {
      case 'invalid_credentials':
        return new HttpError(400, e.message ?? 'Broker rejected the credentials', 'INVALID_CREDENTIALS')
      case 'session_expired':
        return new HttpError(401, e.message ?? 'Broker session expired', 'SESSION_EXPIRED')
      case 'rate_limited':
        return new HttpError(429, 'Broker rate limit hit — retry in a moment', 'RATE_LIMITED')
      case 'network':
        return new HttpError(502, 'Could not reach the broker API — try again', 'BROKER_UNREACHABLE')
      default:
        return new HttpError(502, e.message ?? 'Unexpected broker error', 'BROKER_ERROR')
    }
  }
  return new HttpError(500, e?.message ?? 'Internal server error', 'INTERNAL')
}
