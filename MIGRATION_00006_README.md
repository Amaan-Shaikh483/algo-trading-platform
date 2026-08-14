# Migration 00006: Option Indices Restriction

## Summary

This migration removes the Angel Broking scrip master dependency and restricts the platform to use only 4 option indices for option trading strategies.

## Changes Made

### 1. Database Changes

**Migration File:** `supabase/migrations/00006_seed_option_indices.sql`

The instruments table now contains only these 4 indices:

| Symbol              | Exchange | Token    | Lot Size |
|---------------------|----------|----------|----------|
| NIFTY 50           | NSE      | 99926000 | 65       |
| NIFTY BANK         | NSE      | 99926009 | 30       |
| NIFTY FIN SERVICE  | NSE      | 99926037 | 60       |
| SENSEX             | BSE      | 99919000 | 20       |

### 2. Backend Changes

#### Files Modified:

1. **`backend/src/services/instrumentBootstrap.ts`**
   - Disabled automatic scrip master sync on backend startup
   - Replaced sync logic with deprecation notice

2. **`backend/src/services/instrumentService.ts`**
   - Disabled `syncInstruments()` function
   - Removed Angel Broking scrip master URL constants
   - Function now returns empty summary for backwards compatibility

3. **`backend/src/routes/internal.ts`**
   - Disabled `/internal/jobs/instrument-sync` endpoint
   - Returns deprecation message instead of syncing

4. **`backend/.env`**
   - Removed `SCRIP_MASTER_URL` configuration
   - Added deprecation notice for instrument sync variables

### 3. Frontend Changes

#### Files Modified:

1. **`frontend/src/pages/builder/OptionTimeForm.tsx`**
   - Updated `PREDEFINED_INSTRUMENTS` array with correct lot sizes
   - Users can only select from the 4 predefined indices

2. **`frontend/src/pages/builder/OptionIndicatorForm.tsx`**
   - Updated `PREDEFINED_INSTRUMENTS` array with correct lot sizes
   - Users can only select from the 4 predefined indices

### 4. Configuration Changes

**`.env.example`**
- Removed deprecated instrument sync environment variables
- Added deprecation notices and migration instructions

## Deprecated Environment Variables

The following environment variables are no longer used:

- `SCRIP_MASTER_URL` - Angel Broking scrip master URL
- `INSTRUMENT_BOOT_SYNC` - Auto-sync behavior
- `INSTRUMENT_STALE_HOURS` - Cache staleness threshold
- `INSTRUMENT_SYNC_EXCH_SEG` - Exchange segments to cache

## How to Apply

### Method 1: Run the Migration Script (Recommended)

```bash
# Apply the migration and update the database
node apply-migration-00006.mjs

# Verify the changes
node verify-instruments.mjs
```

### Method 2: Manual SQL Execution

```bash
# Using Supabase CLI
cd supabase
supabase db push

# Or run the SQL directly in your Supabase dashboard
# Execute the contents of: supabase/migrations/00006_seed_option_indices.sql
```

## Verification

After applying the migration, you can verify the changes:

```bash
node verify-instruments.mjs
```

Expected output:
```
✅ NIFTY 50 - Lot size 65 ✓
✅ NIFTY BANK - Lot size 30 ✓
✅ NIFTY FIN SERVICE - Lot size 60 ✓
✅ SENSEX - Lot size 20 ✓
🎉 All instruments have correct lot sizes!
```

## Impact on Features

### ✅ Still Working

- **Option Trading - Time Based**: Users can select from 4 indices
- **Option Trading - Indicator Based**: Users can select from 4 indices
- **Instrument Search**: Still works for existing instruments in database
- **Watchlist**: Can search and add any instrument (including stocks)

### ❌ No Longer Available

- **Angel Broking Scrip Master Sync**: Automatic daily sync disabled
- **Large Instrument Database**: Only 4 indices are seeded by default
- **Stocks & Futures Instrument Search**: Will return no results unless instruments are manually added

### 🔧 Stocks & Futures Support (Optional)

If you need to support the "Stocks & Futures - Indicator Based" strategy type:

1. Manually add instruments to the database
2. Or re-enable scrip master sync by reverting the changes

## Rolling Back

To revert these changes:

1. Restore the original versions of the modified files
2. Run: `node apply-migration-00005.mjs` (if exists)
3. Re-enable scrip master sync in `instrumentBootstrap.ts`
4. Set `SCRIP_MASTER_URL` in `backend/.env`
5. Restart the backend server

## Notes

- The migration uses `ON CONFLICT (exchange, token) DO UPDATE` to safely update existing records
- The frontend forms are hardcoded with these 4 instruments and don't query the database
- The `searchInstruments()` API still works but will only return the 4 seeded indices
- Lot sizes are based on NSE/BSE official specifications as of the migration date

## Support

For issues or questions about this migration:
1. Check that the migration script ran successfully
2. Verify the database contains the 4 indices with correct lot sizes
3. Restart the backend server to clear any cached configurations
