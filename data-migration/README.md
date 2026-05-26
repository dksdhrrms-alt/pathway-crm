# Data Integrity Migration Scripts

이 디렉터리는 CRM 데이터베이스의 무결성 이슈를 정리하기 위한 **idempotent SQL 마이그레이션** 모음이다. 모든 스크립트는 반복 실행해도 안전하며, mutation은 `BEGIN ... COMMIT` 트랜잭션으로 감싸져 있다.

## 발견된 이슈 (A1/A5 에이전트 진단)

| # | 이슈 | 영향 row | 우선순위 |
|---|------|----------|---------|
| 1 | `accounts.owner_name` stale (owner_id와 불일치) | 79 | P0 |
| 2 | `contacts.owner_name` stale | 34 | P0 |
| 3 | 유령 contact (email AND account_id 둘 다 empty) | 323 (~83%) | P0 |
| 4 | 고아 activity (45건 dangling + 20건 broken contact_id) | 65 | P0 |
| 5 | 중복 activity (동일 subject+date+contact) | 13 | P1 |
| 6 | 중복 account 이름 ("trouw nutrtion canada" 4건 등) | 다수 | P1 |
| 7 | 중복 이메일 contact (eric.stejskal@... 2건) | 다수 | P1 |

## 실행 순서

```
01-audit.sql                       (read-only 진단; 항상 먼저 실행)
02-fix-owner-names.sql             (P0: 이름 동기화)
03-archive-ghost-contacts.sql      (P0: 빈 contact archive)
04-cleanup-orphan-activities.sql   (P0: 고아 활동 정리)
05-dedupe-activities.sql           (P1: 활동 중복 제거)
06-merge-duplicate-accounts.sql    (P1: 수동 검토 필요)
07-dedupe-contact-emails.sql       (P1: 수동 검토 필요)
08-add-indexes-and-rls-notes.md    (참고: 인덱스/RLS 권장사항)
```

각 SQL 파일 헤더에는 사전 조건이 명시되어 있다. **반드시 `01-audit.sql` 결과를 먼저 확인한 후 02부터 순차 실행한다.**

## 어디서 실행하나

1. Supabase 대시보드 → 좌측 사이드바 → **SQL Editor**
2. 새 쿼리 탭 열기 → 파일 내용 전체 복사 → 붙여넣기 → **Run**
3. 결과 패널에서 `RAISE NOTICE` 출력 및 검증 SELECT 결과 확인
4. 다음 파일로 진행

또는 로컬에서 `psql` 사용:
```bash
psql "$SUPABASE_DB_URL" -f data-migration/01-audit.sql
```

## 백업 (필수)

mutation 스크립트 (02~07) 실행 전에 **반드시** 백업한다:

### 옵션 1: Supabase Point-in-Time Recovery (권장, Pro 플랜 이상)
- Project Settings → Database → Backups → **PITR 활성화 확인**
- 활성화되어 있으면 임의 시점으로 복원 가능

### 옵션 2: pg_dump (모든 플랜)
```bash
pg_dump "$SUPABASE_DB_URL" --schema=public -F c -f backup-$(date +%Y%m%d).dump
```

### 옵션 3: 테이블 단위 스냅샷 (SQL Editor에서)
```sql
CREATE TABLE accounts_backup_20260526 AS SELECT * FROM accounts;
CREATE TABLE contacts_backup_20260526 AS SELECT * FROM contacts;
CREATE TABLE activities_backup_20260526 AS SELECT * FROM activities;
```

## Rollback 절차

이 마이그레이션은 **destructive DELETE를 사용하지 않는다.** 대신 `archived_at TIMESTAMPTZ` 컬럼에 NOW()를 SET하는 soft-delete 패턴을 쓴다. 따라서 rollback은 단순하다:

```sql
-- 03 rollback: 유령 contact 복원
UPDATE contacts SET archived_at = NULL
WHERE archived_at >= '<migration_timestamp>'
  AND (email IS NULL OR email = '')
  AND (account_id IS NULL OR account_id = '');

-- 04 rollback: orphan activity 복원
UPDATE activities SET archived_at = NULL
WHERE archived_at >= '<migration_timestamp>';

-- 05 rollback: dedupe된 activity 복원
UPDATE activities SET archived_at = NULL
WHERE archived_at >= '<migration_timestamp>';
```

`02-fix-owner-names.sql`은 owner_name 컬럼 값을 덮어쓰므로 rollback이 까다롭다. **반드시 백업을 먼저 만들고 실행**한다. 필요 시:
```sql
UPDATE accounts a SET owner_name = b.owner_name
FROM accounts_backup_20260526 b WHERE a.id = b.id;
```

## 앱 코드 변경 (별도 작업)

`archived_at IS NULL` 필터가 다음 함수들에 추가되어야 한다 (이 디렉터리 외 작업):

- `lib/db.ts` → `dbGetContacts`, `dbGetActivities`, `dbGetAccounts`
- 검색/리포트/카운트 쿼리들

**본 디렉터리는 SQL만 다루며 애플리케이션 코드는 변경하지 않는다.**

## Idempotency 보장

- 모든 `ALTER TABLE ... ADD COLUMN`은 `IF NOT EXISTS` 사용
- 모든 `CREATE INDEX`는 `IF NOT EXISTS` 사용
- 모든 `UPDATE`는 `WHERE archived_at IS NULL` 또는 동등 조건으로 이미 처리된 row를 다시 처리하지 않음
- 02번은 `owner_name IS DISTINCT FROM u.name` 조건으로 이미 동기화된 row는 스킵
