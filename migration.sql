-- ============================================================
-- PATHWAY CRM — FULL MIGRATION (순서 보장)
-- 실행: psql "$DATABASE_URL" -f migration.sql
-- ============================================================

-- ── 0. 확장 ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. RBAC: user_roles 테이블 ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_roles (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'sales_rep'
              CHECK (role IN ('admin','manager','sales_rep','read_only')),
  category    TEXT,
  assigned_by UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_roles_select" ON public.user_roles;
CREATE POLICY "user_roles_select" ON public.user_roles
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "user_roles_admin" ON public.user_roles;
CREATE POLICY "user_roles_admin" ON public.user_roles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- ── 2. RBAC: 헬퍼 함수 ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_get_user_role(p_user_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.user_roles WHERE user_id = p_user_id LIMIT 1;
$$;

-- ── 3. Audit Log 테이블 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name    TEXT NOT NULL,
  record_id     UUID,
  action        TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data      JSONB,
  new_data      JSONB,
  changed_fields TEXT[],
  user_id       UUID,
  user_email    TEXT,
  user_role     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_record  ON public.audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_logs(created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_select" ON public.audit_logs;
CREATE POLICY "audit_select" ON public.audit_logs
  FOR SELECT USING (
    public.fn_get_user_role(auth.uid()) IN ('admin','manager')
  );

DROP POLICY IF EXISTS "audit_insert" ON public.audit_logs;
CREATE POLICY "audit_insert" ON public.audit_logs
  FOR INSERT WITH CHECK (true);

-- ── 4. Audit 트리거 함수 ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_audit_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_old     JSONB;
  v_new     JSONB;
  v_changed TEXT[] := '{}';
  v_col     TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD); v_new := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_old := NULL; v_new := to_jsonb(NEW);
  ELSE
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    FOR v_col IN SELECT key FROM jsonb_each(v_old) LOOP
      IF v_old->v_col IS DISTINCT FROM v_new->v_col THEN
        v_changed := v_changed || v_col;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs
    (table_name, record_id, action, old_data, new_data, changed_fields,
     user_id, user_email)
  VALUES (
    TG_TABLE_NAME,
    CASE WHEN TG_OP='DELETE'
      THEN (v_old->>'id')::UUID
      ELSE (v_new->>'id')::UUID END,
    TG_OP, v_old, v_new, v_changed,
    auth.uid(),
    current_setting('request.jwt.claims', true)::jsonb->>'email'
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── 5. 핵심 테이블에 트리거 부착 ───────────────────────────
DO $$ BEGIN
  -- accounts
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_accounts'
  ) THEN
    CREATE TRIGGER trg_audit_accounts
      AFTER INSERT OR UPDATE OR DELETE ON public.accounts
      FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
  END IF;

  -- contacts
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_contacts'
  ) THEN
    CREATE TRIGGER trg_audit_contacts
      AFTER INSERT OR UPDATE OR DELETE ON public.contacts
      FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
  END IF;

  -- opportunities
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_opportunities'
  ) THEN
    CREATE TRIGGER trg_audit_opportunities
      AFTER INSERT OR UPDATE OR DELETE ON public.opportunities
      FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
  END IF;
END $$;

-- ── 6. Activities 테이블 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activities (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type            TEXT NOT NULL
                  CHECK (type IN ('call','email','meeting','note','deal_change','task')),
  subject         TEXT NOT NULL,
  body            TEXT,
  account_id      UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES public.contacts(id),
  opportunity_id  UUID REFERENCES public.opportunities(id),
  created_by      UUID REFERENCES auth.users(id),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_account ON public.activities(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_opp     ON public.activities(opportunity_id);

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "activities_all" ON public.activities;
CREATE POLICY "activities_all" ON public.activities
  FOR ALL USING (auth.uid() IS NOT NULL);

-- ── 7. Tasks 테이블 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','in_progress','done','cancelled')),
  priority        TEXT NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('urgent','high','normal','low')),
  due_date        DATE NOT NULL,
  account_id      UUID REFERENCES public.accounts(id),
  opportunity_id  UUID REFERENCES public.opportunities(id),
  contact_id      UUID REFERENCES public.contacts(id),
  assigned_to     UUID REFERENCES auth.users(id),
  created_by      UUID REFERENCES auth.users(id),
  completed_at    TIMESTAMPTZ,
  reminder_sent   BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_due      ON public.tasks(due_date) WHERE status != 'done';
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON public.tasks(assigned_to, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_account  ON public.tasks(account_id);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tasks_all" ON public.tasks;
CREATE POLICY "tasks_all" ON public.tasks
  FOR ALL USING (auth.uid() IS NOT NULL);

-- ── 8. Opportunities에 파이프라인 컬럼 추가 ─────────────────
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'prospecting'
    CHECK (stage IN ('prospecting','qualification','proposal',
                     'negotiation','closed_won','closed_lost')),
  ADD COLUMN IF NOT EXISTS probability INT DEFAULT 10,
  ADD COLUMN IF NOT EXISTS days_in_stage INT DEFAULT 0;

-- ── 9. 조회 뷰 ──────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_audit_recent AS
SELECT
  al.id,
  al.table_name,
  al.record_id,
  al.action,
  al.changed_fields,
  al.user_email,
  al.created_at,
  CASE al.action
    WHEN 'INSERT' THEN '생성'
    WHEN 'UPDATE' THEN '수정 (' || array_to_string(al.changed_fields,', ') || ')'
    WHEN 'DELETE' THEN '삭제'
  END AS action_label
FROM public.audit_logs al
ORDER BY al.created_at DESC;

-- ── 완료 확인 ───────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE '✅ Pathway CRM Migration 완료!';
  RAISE NOTICE '   - user_roles 테이블';
  RAISE NOTICE '   - audit_logs 테이블 + 트리거';
  RAISE NOTICE '   - activities 테이블';
  RAISE NOTICE '   - tasks 테이블';
  RAISE NOTICE '   - opportunities 파이프라인 컬럼';
END $$;
