#!/usr/bin/env node
/**
 * Apply migration 00007: Order Type + Risk Management configuration.
 *
 * Adds the nullable `order_type` / `risk_management` JSONB columns to
 * public.strategies, backfills every existing row from its current rules, and
 * mirrors both blocks back into `rules` so the engines see them too.
 *
 * Usage:
 *   node apply-migration-00007.mjs            # apply via Postgres connection
 *   node apply-migration-00007.mjs --print    # just print the SQL to run manually
 *
 * Connection: SUPABASE_DB_URL (preferred) from backend/.env, else falls back to
 * printing the SQL for the Supabase SQL editor — the REST API cannot run DDL.
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const MIGRATION = resolve('./supabase/migrations/00007_order_type_risk_management.sql')

if (!existsSync(MIGRATION)) {
  console.error(`❌ Migration file not found: ${MIGRATION}`)
  process.exit(1)
}

const SQL = readFileSync(MIGRATION, 'utf-8')

// Load backend/.env without requiring dotenv to be installed at the root.
const envPath = resolve('./backend/.env')
const env = {}
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^([^#][^=]*)=(.*)$/)
    if (match) env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '')
  }
}

const DB_URL = process.env.SUPABASE_DB_URL || env.SUPABASE_DB_URL || process.env.DATABASE_URL || env.DATABASE_URL

function printManualInstructions() {
  console.log('📋 Apply this migration manually:\n')
  console.log('  1. Open your project\'s Supabase SQL editor (Dashboard → SQL → New query)')
  console.log('  2. Paste the contents of supabase/migrations/00007_order_type_risk_management.sql')
  console.log('  3. Run it\n')
  console.log('🔗 Or with the Supabase CLI:')
  console.log('     npx supabase db push\n')
  console.log('🔗 Or set SUPABASE_DB_URL in backend/.env and re-run this script.\n')
  console.log('─'.repeat(70))
  console.log(SQL)
  console.log('─'.repeat(70))
}

async function main() {
  if (process.argv.includes('--print') || !DB_URL) {
    if (!DB_URL && !process.argv.includes('--print')) {
      console.log('⚠️  No SUPABASE_DB_URL / DATABASE_URL found in backend/.env.\n')
    }
    printManualInstructions()
    return
  }

  let pg
  try {
    pg = await import('pg')
  } catch {
    console.log('⚠️  The `pg` package is not installed (npm i -D pg) — falling back to manual mode.\n')
    printManualInstructions()
    return
  }

  const client = new pg.default.Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
  })

  console.log('🔄 Applying migration 00007 — Order Type + Risk Management...\n')
  await client.connect()
  try {
    // The whole migration is idempotent (add column if not exists + guarded
    // backfills), so a single transaction is safe to re-run.
    await client.query('begin')
    await client.query(SQL)
    await client.query('commit')
    console.log('✅ Migration applied.\n')

    const { rows } = await client.query(
      `select order_type ->> 'type' as order_type,
              risk_management -> 'profitTrailing' ->> 'type' as trailing,
              count(*)::int as strategies
       from public.strategies
       group by 1, 2
       order by 1, 2`,
    )
    if (rows.length === 0) {
      console.log('📊 No strategies to backfill yet.')
    } else {
      console.log('📊 Strategies by configuration:')
      for (const r of rows) {
        console.log(`   ${String(r.order_type).padEnd(6)} · ${String(r.trailing).padEnd(16)} → ${r.strategies}`)
      }
    }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('❌ Migration failed:', err.message)
  process.exit(1)
})
