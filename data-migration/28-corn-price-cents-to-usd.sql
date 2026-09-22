-- ============================================================
-- Convert historical corn prices from cents/bu (Yahoo raw) to
-- USD/bu (our canonical unit).
--
-- CBOT corn futures (ZC=F) are quoted on Yahoo in cents per bushel.
-- Our COMMODITIES config labels corn as 'USD/bu' and the dashboard
-- renders that as "$X.XX/bu", so a value of 543 (cents) rendered as
-- "$543 /bu" — nonsense that the sales team caught. The ingest cron
-- now divides by 100 on the way in (see fetchOne() in
-- app/api/cron/commodity-prices/route.ts); this migration fixes the
-- rows already in the table so historical charts don't have a
-- discontinuity.
--
-- Idempotent-ish: only rows above the sanity threshold (any corn
-- futures close < $20 in the last 20 years is impossible; anything
-- >= $20 must be the old cents-based value that needs division).
-- ============================================================

UPDATE commodity_prices
SET price = price / 100
WHERE commodity_key = 'corn'
  AND price >= 20;
