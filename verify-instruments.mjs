#!/usr/bin/env node
/**
 * Verify the 4 option indices in the database have correct lot sizes
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load backend .env
config({ path: resolve(process.cwd(), 'backend/.env') })

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

async function main() {
  console.log('🔍 Verifying option indices in database...\n')

  const { data, error } = await supabase
    .from('instruments')
    .select('token, symbol, name, exchange, lotsize')
    .eq('instrumenttype', 'INDEX')
    .order('symbol')

  if (error) {
    console.error('❌ Query failed:', error.message)
    process.exit(1)
  }

  if (!data || data.length === 0) {
    console.log('⚠️  No INDEX instruments found in database')
    console.log('   Run: node apply-migration-00006.mjs')
    process.exit(0)
  }

  console.log('┌─────────────────────────┬──────────┬─────────┬──────────┐')
  console.log('│ Symbol                  │ Exchange │ Token   │ Lot Size │')
  console.log('├─────────────────────────┼──────────┼─────────┼──────────┤')

  data.forEach((inst) => {
    const symbol = (inst.symbol || '').padEnd(23)
    const exchange = (inst.exchange || '').padEnd(8)
    const token = (inst.token || '').padEnd(7)
    const lotsize = String(inst.lotsize || 0).padStart(8)
    console.log(`│ ${symbol} │ ${exchange} │ ${token} │ ${lotsize} │`)
  })

  console.log('└─────────────────────────┴──────────┴─────────┴──────────┘')

  // Verify expected values
  const expected = {
    'NIFTY 50': 65,
    'NIFTY BANK': 30,
    'NIFTY FIN SERVICE': 60,
    'SENSEX': 20,
  }

  console.log('\n✅ Verification:')
  let allCorrect = true
  for (const [symbol, expectedLot] of Object.entries(expected)) {
    const inst = data.find((i) => i.symbol === symbol)
    if (!inst) {
      console.log(`   ❌ ${symbol} - NOT FOUND`)
      allCorrect = false
    } else if (inst.lotsize !== expectedLot) {
      console.log(`   ❌ ${symbol} - Expected ${expectedLot}, got ${inst.lotsize}`)
      allCorrect = false
    } else {
      console.log(`   ✅ ${symbol} - Lot size ${expectedLot} ✓`)
    }
  }

  if (allCorrect) {
    console.log('\n🎉 All instruments have correct lot sizes!')
  } else {
    console.log('\n⚠️  Some instruments need correction. Run: node apply-migration-00006.mjs')
  }
}

main().catch((err) => {
  console.error('❌ Verification failed:', err.message)
  process.exit(1)
})
