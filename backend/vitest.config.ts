import { defineConfig } from 'vitest/config'

/**
 * Formal unit suites (spec §6 step 10): rule evaluator + risk manager.
 * Offline by contract — the risk suites exercise authorizeOrder's async
 * wiring, whose notify/audit side effects are fail-soft; the dummy Supabase
 * env keeps getServiceClient() constructible without network (mirrors the
 * integration harnesses in scripts/verify-*.mjs, which remain the smoke layer).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      SUPABASE_URL: 'https://offline.supabase.test',
      SUPABASE_SERVICE_ROLE_KEY: 'offline-key',
    },
  },
})
