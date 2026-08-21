-- ============================================================
-- Opportunity stages — rename to the trial-driven cycle the sales
-- team proposed. Old labels get remapped in place so historical
-- weighted-pipeline math keeps working the moment code deploys.
--
-- New set (with default probability):
--   Prospect (5)
--   Qualified (15)
--   Trial Started (40)
--   Trial Ended (65)
--   Results Successful (80)
--   Won (100)
--   Stalled or Lost (0)
--
-- Mapping from the old labels (per user confirmation):
--   Prospecting     → Prospect
--   Qualification   → Qualified
--   Proposal        → Trial Ended         (proposal follows the trial)
--   Negotiation     → Results Successful  (negotiating after results)
--   Closed Won      → Won
--   Closed Lost     → Stalled or Lost     (bucket also holds pauses
--                                          the team still hopes to win)
-- ============================================================

BEGIN;

UPDATE opportunities SET stage = 'Prospect'           WHERE stage = 'Prospecting';
UPDATE opportunities SET stage = 'Qualified'          WHERE stage = 'Qualification';
UPDATE opportunities SET stage = 'Trial Ended'        WHERE stage = 'Proposal';
UPDATE opportunities SET stage = 'Results Successful' WHERE stage = 'Negotiation';
UPDATE opportunities SET stage = 'Won'                WHERE stage = 'Closed Won';
UPDATE opportunities SET stage = 'Stalled or Lost'    WHERE stage = 'Closed Lost';

-- Backfill probability where the rep hasn't set one explicitly, using
-- the new stage defaults. Existing non-null probabilities stay put so
-- we don't overwrite a rep's judgment.
UPDATE opportunities SET probability = 5   WHERE stage = 'Prospect'           AND probability IS NULL;
UPDATE opportunities SET probability = 15  WHERE stage = 'Qualified'          AND probability IS NULL;
UPDATE opportunities SET probability = 40  WHERE stage = 'Trial Started'      AND probability IS NULL;
UPDATE opportunities SET probability = 65  WHERE stage = 'Trial Ended'        AND probability IS NULL;
UPDATE opportunities SET probability = 80  WHERE stage = 'Results Successful' AND probability IS NULL;
UPDATE opportunities SET probability = 100 WHERE stage = 'Won'                AND probability IS NULL;
UPDATE opportunities SET probability = 0   WHERE stage = 'Stalled or Lost'    AND probability IS NULL;

COMMIT;
