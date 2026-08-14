#!/usr/bin/env node
/**
 * Apply migration 00006: Update instruments with correct lot sizes
 * 
 * This script updates the 4 option indices with the correct lot sizes:
 * - Nifty 50: 65 units
 * - Nifty Bank: 30 units
 * - Nifty Fin Service: 60 units
 * - Sensex: 20 units
 */

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load backend .env
config({ path: resolve(process.cwd(), 'backend/.env') })

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

async function main() {
  console.log('🚀 Applying migration 00006: Update option indices lot sizes\n')

  const instruments = [
    { token: '99926000', symbol: 'NIFTY 50', name: 'Nifty 50', exchange: 'NSE', lotsize: 65 },
    { token: '99926009', symbol: 'NIFTY BANK', name: 'Nifty Bank', exchange: 'NSE', lotsize: 30 },
    { token: '99926037', symbol: 'NIFTY FIN SERVICE', name: 'Nifty Fin Service', exchange: 'NSE', lotsize: 60 },
    { token: '99919000', symbol: 'SENSEX', name: 'Sensex', exchange: 'BSE', lotsize: 20 },
  ]

  for (const inst of instruments) {
    const { error } = await supabase
      .from('instruments')
      .upsert(
        {
          token: inst.token,
          symbol: inst.symbol,
          name: inst.name,
          exchange: inst.exchange,
          segment: 'equity',
          instrumenttype: 'INDEX',
          expiry: null,
          strike: null,
          lotsize: inst.lotsize,
          tick_size: 0.05,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'exchange,token' }
      )

    if (error) {
      console.error(`❌ Failed to upsert ${inst.symbol}:`, error.message)
      process.exit(1)
    }

    console.log(`✅ ${inst.symbol.padEnd(20)} - Lot Size: ${inst.lotsize}`)
  }

  console.log('\n✨ Migration completed successfully!')
  console.log('\n📊 Verify the changes:')
  console.log("   SELECT symbol, exchange, lotsize FROM instruments WHERE instrumenttype = 'INDEX' ORDER BY symbol;")
}

main().catch((err) => {
  console.error('❌ Migration failed:', err.message)
  process.exit(1)
})
