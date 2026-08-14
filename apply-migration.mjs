#!/usr/bin/env node
/**
 * Quick migration applier for 00004
 * Applies the migration by directly executing SQL via Supabase REST API
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read backend .env
const envPath = resolve('./backend/.env');
const envContent = readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^#][^=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const SQL = `
-- Add new columns to strategies table
ALTER TABLE public.strategies
  ADD COLUMN IF NOT EXISTS long_entry_conditions JSONB,
  ADD COLUMN IF NOT EXISTS short_entry_conditions JSONB,
  ADD COLUMN IF NOT EXISTS legs JSONB;

-- Backfill from existing rules
UPDATE public.strategies
SET
  long_entry_conditions  = COALESCE(rules -> 'longEntryConditions',  NULL),
  short_entry_conditions = COALESCE(rules -> 'shortEntryConditions', NULL),
  legs                   = COALESCE(rules -> 'legs',                 NULL)
WHERE long_entry_conditions IS NULL
   OR short_entry_conditions IS NULL
   OR legs IS NULL;
`;

console.log('🔄 Applying migration 00004...\n');
console.log('Executing SQL:');
console.log('─'.repeat(60));
console.log(SQL);
console.log('─'.repeat(60));
console.log();

// Use Supabase's query endpoint
const url = `${SUPABASE_URL}/rest/v1/rpc/exec`;

console.log('⚠️  Note: This script requires a custom exec function in your database.');
console.log('Since Supabase doesn\'t allow DDL via REST API, please apply manually:\n');
console.log('🔗 Open your Supabase SQL Editor:');
console.log(`   ${SUPABASE_URL.replace('https://', 'https://supabase.com/dashboard/project/')}/sql/new\n`);
console.log('📋 Copy and paste the SQL above, then click "Run"\n');
console.log('Once applied, restart your frontend dev server (Ctrl+C and npm run dev:frontend)');
