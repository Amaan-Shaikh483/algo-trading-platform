import 'dotenv/config'
import { logger } from './lib/logger'
import { LiveEngineSupervisor } from './services/live/liveEngineSupervisor'

/**
 * Live trading worker — dedicated persistent Node process (spec §3.6 +
 * CHECKPOINT-04 decision: Edge Functions can't hold a WebSocket).
 *
 *   npm run worker -w backend
 *
 * Deploy as a separate service from the API (Render: extra web/worker service
 * on the same repo+env). Both share the Supabase DB: the API owns user-facing
 * mutations (kill switch, risk settings), the worker owns market data, signal
 * evaluation and order execution.
 */

const supervisor = new LiveEngineSupervisor()

async function main(): Promise<void> {
  logger.info('═══ live-engine worker boot ═══')
  await supervisor.start()
}

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logger.info(`received ${signal} — flushing runtime state and stopping feeds`)
  try {
    await supervisor.stop()
  } finally {
    process.exit(0)
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('unhandledRejection', (reason) => {
  // Trading processes must not die silently: log loudly, stay alive, let the
  // supervisor loops continue (they have their own guards).
  logger.error('unhandledRejection in worker', { reason: reason instanceof Error ? reason.message : String(reason) })
})
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException in worker — exiting for supervisor restart', { error: err.message, stack: err.stack })
  process.exit(1)
})

main().catch((err) => {
  logger.error('worker boot failed', { error: (err as Error).message })
  process.exit(1)
})
