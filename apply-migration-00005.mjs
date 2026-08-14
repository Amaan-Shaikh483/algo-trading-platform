#!/usr/bin/env node
/**
 * Apply migration 00005 - Add strategy_type column
 * Executes SQL directly via Supabase Management API
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

// Read the migration file
const migrationPath = resolve('./supabase/migrations/00005_add_strategy_type.sql');
const SQL = readFileSync(migrationPath, 'utf-8');

console.log('🔄 Applying migration 00005 - Add strategy_type column...\n');
console.log('Executing SQL:');
console.log('─'.repeat(60));
console.log(SQL);
console.log('─'.repeat(60));
console.log();

// Execute each statement separately
const statements = SQL
  .split(';')
  .map(s => s.trim())
  .filter(s => s && !s.startsWith('--') && s.length > 0);

console.log(`📝 Found ${statements.length} SQL statements to execute\n`);

// Use Supabase REST API with RPC to execute SQL
async function executeSQL(sql) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`
    },
    body: JSON.stringify({ query: sql })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }

  return response;
}

// Since Supabase doesn't expose a direct SQL execution endpoint,
// we need to use the PostgREST API with a workaround
console.log('⚠️  Supabase REST API does not support direct DDL execution.\n');
console.log('📋 Please apply this migration manually:\n');
console.log('1. Go to: https://supabase.com/dashboard/project/sfalbekiuafllxfigetn/sql/new');
console.log('2. Copy the SQL from: supabase/migrations/00005_add_strategy_type.sql');
console.log('3. Paste it into the SQL Editor');
console.log('4. Click "Run" or press Ctrl+Enter\n');
console.log('🔗 Or use the Supabase CLI:');
console.log('   npx supabase db push --db-url "your-connection-string"\n');
console.log('After applying the migration, your strategy type will be saved correctly! ✨');
