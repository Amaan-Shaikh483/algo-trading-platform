import { logger } from '../lib/logger'

/**
 * DEPRECATED: Angel Broking scrip master bootstrap disabled.
 * 
 * The instruments table is now manually seeded with only 4 indices required
 * for option trading: NIFTY 50, NIFTY BANK, NIFTY FIN SERVICE, SENSEX.
 * 
 * Run the migration to seed: supabase/migrations/00006_seed_option_indices.sql
 */

export function scheduleInstrumentBootstrap(): void {
  // DISABLED: Angel Broking scrip master sync removed.
  // Instruments table is now manually seeded with only 4 required indices.
  // Use the migration script to populate: supabase/migrations/00006_seed_option_indices.sql
  logger.info('instrument bootstrap: disabled (using manual seed for 4 option indices)')
}
