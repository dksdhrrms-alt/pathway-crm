-- ============================================================
-- Contact Org Map — Relationship visualization fields.
--
-- Powers the "Org Map" tab on an Account's detail page. Reps mark who
-- the Decision Maker is, who the Champion is, who's blocking, and the
-- reporting chain (reports_to_contact_id → their manager inside the
-- same company). The Account page renders this as a ReactFlow tree.
--
-- Three fields:
--   role_in_deal       — tag the rep assigns ("decision_maker",
--                        "champion", "influencer", "user", "blocker",
--                        "unknown"). Drives the node color/icon on
--                        the map.
--   reports_to_contact_id — nullable self-FK. When set, the map
--                        draws an edge from this contact UP to the
--                        manager, giving the hierarchy its shape.
--                        ON DELETE SET NULL so removing a contact
--                        just promotes their reports to root.
--   influence_score    — 1-5. Drives the node size/outline opacity
--                        so a Senior VP visually dwarfs a staff rep.
--
-- Account-wide, not per-opportunity, by Dave's call. One company has
-- one org structure; who's a Champion for Deal A tends to also be the
-- Champion for Deal B.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS role_in_deal text
    CHECK (role_in_deal IS NULL OR role_in_deal IN (
      'decision_maker','champion','influencer','user','blocker','unknown'
    )),
  ADD COLUMN IF NOT EXISTS reports_to_contact_id text
    REFERENCES contacts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS influence_score smallint
    CHECK (influence_score IS NULL OR influence_score BETWEEN 1 AND 5);

CREATE INDEX IF NOT EXISTS idx_contacts_reports_to
  ON contacts (reports_to_contact_id);

COMMENT ON COLUMN contacts.role_in_deal IS
  'Rep-assigned role in deal discussions. decision_maker | champion | influencer | user | blocker | unknown. Account-wide, not per-opportunity.';
COMMENT ON COLUMN contacts.reports_to_contact_id IS
  'Self-FK to another contact within the same account. Draws the reporting hierarchy edge in the Org Map.';
COMMENT ON COLUMN contacts.influence_score IS
  '1 (minimal) to 5 (CEO-level). Drives node size on the Org Map so seniority is visible at a glance.';
