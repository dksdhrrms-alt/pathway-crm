# 08 - Indexes, RLS & App-Code Follow-ups (NOTES)

이 파일은 **SQL을 실행하지 않는다.** 01~07 마이그레이션을 마친 뒤 권장되는 후속 작업과 코드 변경 지점을 정리한 참고용 문서다. 각 SQL 블록은 Supabase SQL Editor에서 개별 검토 후 적용한다.

---

## 1. 권장 인덱스

### 1.1 외래키 (조회 핫패스)

대량 JOIN/필터의 기반이 되는 컬럼들이다.

```sql
CREATE INDEX IF NOT EXISTS accounts_owner_id_idx        ON accounts(owner_id);

CREATE INDEX IF NOT EXISTS contacts_account_id_idx      ON contacts(account_id);
CREATE INDEX IF NOT EXISTS contacts_owner_id_idx        ON contacts(owner_id);

CREATE INDEX IF NOT EXISTS activities_contact_id_idx    ON activities(contact_id);
CREATE INDEX IF NOT EXISTS activities_account_id_idx    ON activities(account_id);
CREATE INDEX IF NOT EXISTS activities_owner_id_idx      ON activities(owner_id);
CREATE INDEX IF NOT EXISTS activities_date_idx          ON activities(date DESC);
```

### 1.2 Soft-delete 필터 (archived_at IS NULL)

03 / 04 / 06 에서 추가한 `archived_at` 컬럼 위에 partial index를 두면 활성 row만 빠르게 스캔된다. 이미 스크립트에서 일부 생성했으나 누락된 경우 보완:

```sql
CREATE INDEX IF NOT EXISTS contacts_active_idx
  ON contacts(id) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS activities_active_idx
  ON activities(id) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS accounts_active_idx
  ON accounts(id) WHERE archived_at IS NULL;
```

조합 인덱스 예시 (active 사용자 contact 리스트가 잦으면):

```sql
CREATE INDEX IF NOT EXISTS contacts_owner_active_idx
  ON contacts(owner_id) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS activities_owner_date_active_idx
  ON activities(owner_id, date DESC) WHERE archived_at IS NULL;
```

### 1.3 중복 방지 unique 인덱스 (선택)

06 / 07이 끝난 뒤 재발 방지용:

```sql
-- accounts: 같은 normalized name 중복 금지 (활성 row만)
CREATE UNIQUE INDEX IF NOT EXISTS accounts_name_unique_idx
  ON accounts (LOWER(TRIM(name))) WHERE archived_at IS NULL;

-- contacts: 같은 email 중복 금지 (활성 + non-empty email만)
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_unique_idx
  ON contacts (LOWER(TRIM(email)))
  WHERE archived_at IS NULL AND email IS NOT NULL AND email <> '';
```

> 주의: unique index 추가 전에 06/07 결과로 모든 중복이 해소되었는지 다시 audit해야 한다. 잔존 중복이 있으면 CREATE가 실패한다.

---

## 2. Row Level Security (RLS) 권장

### 2.1 `users` 테이블 — password 컬럼 노출 차단

`users.password` 컬럼이 client/anon 키로 SELECT 가능하면 즉시 차단한다.

```sql
-- 1) RLS 활성화
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 2) 모든 SELECT 거부 (server-only service_role만 통과)
DROP POLICY IF EXISTS users_no_client_select ON users;
CREATE POLICY users_no_client_select
  ON users FOR SELECT
  USING (false);

-- 3) anon/authenticated 의 직접 권한 제거
REVOKE SELECT ON users FROM anon, authenticated;

-- 4) 필요하다면 password 컬럼 자체에서만 권한 제거
REVOKE SELECT (password) ON users FROM anon, authenticated;
```

서버 코드는 `SUPABASE_SERVICE_ROLE_KEY`로 접근하므로 RLS를 우회한다. 클라이언트에서 사용자 목록이 필요한 경우 `password`를 제외한 view를 만들어 노출:

```sql
CREATE OR REPLACE VIEW users_public AS
  SELECT id, name, email, role, created_at FROM users;

GRANT SELECT ON users_public TO anon, authenticated;
```

### 2.2 기타 테이블 RLS (선택)

`accounts`, `contacts`, `activities`, `opportunities` 도 모두 `ENABLE RLS` 권장. 현재 앱이 service_role로 서버에서만 쿼리한다면 anon에 대해 정책 없이 RLS를 켜는 것만으로 client 직통을 차단할 수 있다.

```sql
ALTER TABLE accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
```

---

## 3. 앱 코드 변경 (별도 작업 — 본 디렉터리 범위 외)

`archived_at` 컬럼을 새로 도입했으므로, **활성 row만 보고 싶은 모든 쿼리에 `WHERE archived_at IS NULL` 필터가 추가되어야 한다.** 본 디렉터리는 SQL만 다루며 코드는 수정하지 않는다. 변경이 필요한 지점:

### 3.1 `lib/db.ts`

- `dbGetContacts` — list/count 모두
- `dbGetContactById` — archived도 보일지 결정 (관리자만 보이게)
- `dbGetActivities`, `dbGetActivitiesByContactId`, `dbGetActivitiesByAccountId`
- `dbGetAccounts`, `dbGetAccountById`
- 통계/리포트용 카운트 쿼리 전반

### 3.2 검색/리포트

- 글로벌 검색
- 대시보드 KPI (총 contact, 총 activity 수)
- 소유자별 집계

### 3.3 권장 패턴

```ts
// before
const { data } = await supabase.from('contacts').select('*');

// after
const { data } = await supabase
  .from('contacts')
  .select('*')
  .is('archived_at', null);
```

또는 SQL view로 감싸 default-active 뷰만 앱에서 사용:

```sql
CREATE OR REPLACE VIEW contacts_active AS
  SELECT * FROM contacts WHERE archived_at IS NULL;
CREATE OR REPLACE VIEW activities_active AS
  SELECT * FROM activities WHERE archived_at IS NULL;
CREATE OR REPLACE VIEW accounts_active AS
  SELECT * FROM accounts WHERE archived_at IS NULL;
```

---

## 4. 운영 권장

- **백업 정책**: Supabase Project Settings → Database → Backups에서 PITR이 켜져 있는지 매주 확인
- **재발 모니터링**: 주 1회 `01-audit.sql`을 실행하여 새 mismatch / ghost / orphan이 생기는지 추적
- **owner_name 동기화 trigger** (선택): `accounts.owner_id` / `contacts.owner_id` UPDATE 시 `owner_name`을 자동 갱신하는 trigger를 두면 02번 이슈는 영구 차단 가능. 별도 마이그레이션으로 다룬다.
