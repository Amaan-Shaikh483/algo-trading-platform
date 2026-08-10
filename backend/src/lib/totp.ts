import { authenticator } from 'otplib'

/**
 * Generates the current 6-digit TOTP from a base32 secret, for Angel One
 * login (spec 3.2: "generates TOTP on the fly from stored secret").
 * The default otplib window tolerates minor clock skew.
 */
export function generateTotp(base32Secret: string): string {
  return authenticator.generate(base32Secret.trim().replace(/ /g, ''))
}
