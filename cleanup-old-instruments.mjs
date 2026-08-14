#!/usr/bin/env node
/**
 * Optional cleanup: Remove all instruments except the 4 required option indices
 * 
 * WARNING: This will delete all other instruments from the database!
 * Run this only if you want to clean up old Angel Broking scrip master data.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
import readline from 'readline'

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

const KEEP_TOKENS = ['99926000', '99926009', '99926037', '99919000']

async function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'yes')
    })
  })
}

async function main() {
  console.log('🧹 Instrument Cleanup Utility\n')
  console.log('⚠️  WARNING: This will delete ALL instruments except the 4 option indices!\n')

  // Count current instruments
  const { count: totalCount, error: countError } = await supabase
    .from('instruments')
    .select('id', { count: 'exact', head: true })

  if (countError) {
    console.error('❌ Failed to count instruments:', countError.message)
    process.exit(1)
  }

  const { count: keepCount, error: keepError } = await supabase
    .from('instruments')
    .select('id', { count: 'exact', head: true })
    .in('token', KEEP_TOKENS)

  if (keepError) {
    console.error('❌ Failed to count instruments to keep:', keepError.message)
    process.exit(1)
  }

  const deleteCount = (totalCount || 0) - (keepCount || 0)

  console.log(`📊 Current database state:`)
  console.log(`   Total instruments: ${totalCount}`)
  console.log(`   Will keep: ${keepCount} (4 option indices)`)
  console.log(`   Will delete: ${deleteCount}`)
  console.log()

  if (deleteCount === 0) {
    console.log('✨ Database is already clean! No instruments to delete.')
    process.exit(0)
  }

  const confirmed = await askConfirmation(
    `❓ Are you sure you want to delete ${deleteCount} instruments? (type "yes" to confirm): `
  )

  if (!confirmed) {
    console.log('❌ Cleanup cancelled.')
    process.exit(0)
  }

  console.log('\n🗑️  Deleting old instruments...')

  const { error: deleteError } = await supabase
    .from('instruments')
    .delete()
    .not('token', 'in', `(${KEEP_TOKENS.join(',')})`)

  if (deleteError) {
    console.error('❌ Failed to delete instruments:', deleteError.message)
    process.exit(1)
  }

  console.log(`✅ Successfully deleted ${deleteCount} instruments`)

  // Verify final state
  const { count: finalCount, error: finalError } = await supabase
    .from('instruments')
    .select('id', { count: 'exact', head: true })

  if (finalError) {
    console.error('⚠️  Failed to verify final count:', finalError.message)
  } else {
    console.log(`📊 Final count: ${finalCount} instruments remaining`)
  }

  console.log('\n✨ Cleanup completed!')
  console.log('   Run: node verify-instruments.mjs to verify the remaining instruments')
}

main().catch((err) => {
  console.error('❌ Cleanup failed:', err.message)
  process.exit(1)
})
