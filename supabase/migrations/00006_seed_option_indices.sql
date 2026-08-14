-- Migration: Seed instruments table with 4 option indices only
-- Description: Remove dependency on Angel Broking scrip master and manually seed
--              the 4 indices required for option trading strategies:
--              NIFTY 50, NIFTY BANK, NIFTY FIN SERVICE, SENSEX

-- Clear existing instruments (optional - only if you want a clean slate)
-- TRUNCATE TABLE instruments CASCADE;

-- Insert the 4 required option indices
INSERT INTO instruments (
  token,
  symbol,
  name,
  exchange,
  segment,
  instrumenttype,
  expiry,
  strike,
  lotsize,
  tick_size,
  updated_at
) VALUES
  -- NIFTY 50
  (
    '99926000',
    'NIFTY 50',
    'Nifty 50',
    'NSE',
    'equity',
    'INDEX',
    NULL,
    NULL,
    65,
    0.05,
    NOW()
  ),
  -- NIFTY BANK
  (
    '99926009',
    'NIFTY BANK',
    'Nifty Bank',
    'NSE',
    'equity',
    'INDEX',
    NULL,
    NULL,
    30,
    0.05,
    NOW()
  ),
  -- NIFTY FIN SERVICE
  (
    '99926037',
    'NIFTY FIN SERVICE',
    'Nifty Fin Service',
    'NSE',
    'equity',
    'INDEX',
    NULL,
    NULL,
    60,
    0.05,
    NOW()
  ),
  -- SENSEX
  (
    '99919000',
    'SENSEX',
    'Sensex',
    'BSE',
    'equity',
    'INDEX',
    NULL,
    NULL,
    20,
    0.05,
    NOW()
  )
ON CONFLICT (exchange, token) 
DO UPDATE SET
  symbol = EXCLUDED.symbol,
  name = EXCLUDED.name,
  segment = EXCLUDED.segment,
  instrumenttype = EXCLUDED.instrumenttype,
  lotsize = EXCLUDED.lotsize,
  tick_size = EXCLUDED.tick_size,
  updated_at = NOW();

-- Verify the seed
-- SELECT token, symbol, name, exchange, lotsize FROM instruments ORDER BY symbol;
