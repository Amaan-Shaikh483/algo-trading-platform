import crypto from 'crypto'
import { env } from '../config/env'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96-bit nonce, recommended for GCM

/**
 * Section 3.1: per-user Angel One API key + TOTP secret are stored encrypted
 * (AES-256-GCM). The MPIN is never persisted at all — it is used once during
 * login and then discarded. The encryption key lives only in the backend env
 * and is never sent to the frontend.
 *
 * Ciphertext format: "v1.<base64(iv)>.<base64(authTag)>.<base64(ciphertext)>"
 * The "v1" prefix allows future key/algorithm rotation without a flag day.
 */
export function encryptSecret(plaintext: string): string {
  const key = env.brokerEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return ['v1', iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.')
}

export function decryptSecret(encrypted: string): string {
  const key = env.brokerEncryptionKey()
  const [version, ivB64, tagB64, dataB64] = encrypted.split('.')
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Encrypted secret has an unrecognized format')
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

/** True if a value looks like it was produced by encryptSecret (vs accidental plaintext). */
export function isEncrypted(value: string): boolean {
  return value.startsWith('v1.') && value.split('.').length === 4
}
