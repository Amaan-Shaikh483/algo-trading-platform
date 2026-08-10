import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../../.env') })

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}. See .env.example at the repo root.`)
  }
  return value
}

/**
 * Centralized, validated environment config. The app refuses to boot with
 * incomplete config rather than failing mid-request — especially important
 * for BROKER_ENCRYPTION_KEY, which must never rotate silently (rotating it
 * would make all stored broker credentials undecryptable).
 */
export const env = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',

  supabaseUrl: () => required('SUPABASE_URL'),
  supabaseServiceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),

  /** 32 bytes as 64 hex chars; used for AES-256-GCM over broker credentials. */
  brokerEncryptionKey: (): Buffer => {
    const hex = required('BROKER_ENCRYPTION_KEY')
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error('BROKER_ENCRYPTION_KEY must be 32 bytes as 64 hex chars (see .env.example for generation command).')
    }
    return Buffer.from(hex, 'hex')
  },

  /** Shared secret guarding /internal/* job endpoints (called by Supabase cron edge functions). */
  cronSecret: () => required('CRON_SECRET'),

  /**
   * Optional §3.9 notification channels — empty = not configured (the UI
   * says so honestly and delivery for that channel is skipped):
   *  - TELEGRAM_BOT_TOKEN: create via @BotFather; users link their chat ID in
   *    notification preferences. Live sendMessage when set.
   *  - NOTIFY_EMAIL_WEBHOOK_URL: generic endpoint (e.g. a Supabase Edge
   *    Function backed by Resend/SES) receiving POST { userId, type, title,
   *    body, at } — the webhook resolves the user's email and sends.
   */
  telegramBotToken: () => process.env.TELEGRAM_BOT_TOKEN ?? '',
  notifyEmailWebhook: () => process.env.NOTIFY_EMAIL_WEBHOOK_URL ?? '',
} as const
