import express from 'express'
import cors from 'cors'
import { env } from './config/env'
import { logger } from './lib/logger'
import { apiRouter } from './routes'
import { internalRouter } from './routes/internal'
import { toHttpError } from './lib/httpError'
import { scheduleInstrumentBootstrap } from './services/instrumentBootstrap'
import { scheduleSessionBootstrap } from './services/sessionBootstrap'

export function createApp(): express.Express {
  const app = express()

  app.use(cors({ origin: true, credentials: true }))
  app.use(express.json({ limit: '1mb' }))

  app.use('/api', apiRouter)
  app.use('/internal', internalRouter)

  // 404 for unknown routes
  app.use(['/api', '/internal'], (_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  // Central error handler — maps BrokerError/HttpError to safe client payloads;
  // never leaks stack traces.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const httpErr = toHttpError(err)
    if (httpErr.statusCode >= 500) {
      logger.error('request failed', { error: err.message, code: httpErr.code })
    }
    res.status(httpErr.statusCode).json({ error: httpErr.message, code: httpErr.code })
  })

  return app
}

if (require.main === module) {
  const app = createApp()
  app.listen(env.port, () => {
    logger.info(`backend listening`, { port: env.port })
    scheduleInstrumentBootstrap()
    scheduleSessionBootstrap()
  })
}
