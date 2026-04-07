#!/bin/bash
# ============================================================
# Pathway CRM — 원클릭 셋업 스크립트
# 사용법: bash setup.sh
# ============================================================

set -e  # 에러 발생 시 즉시 중단

# ── 색상 출력 ────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Pathway CRM — DB 셋업 시작         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Supabase DB URL 입력 ─────────────────────────────────────
# Supabase Dashboard > Settings > Database > Connection string > URI
# 예: postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres

if [ -z "$DATABASE_URL" ]; then
  echo -e "${YELLOW}DATABASE_URL 환경변수가 없습니다.${NC}"
  echo ""
  echo "Supabase Dashboard에서 복사하는 방법:"
  echo "  1. https://supabase.com/dashboard 접속"
  echo "  2. pathway-crm 프로젝트 선택"
  echo "  3. Settings → Database"
  echo "  4. 'Connection string' → URI 탭 복사"
  echo "  5. [YOUR-PASSWORD] 부분을 실제 DB 비밀번호로 교체"
  echo ""
  read -p "DATABASE_URL을 직접 입력하세요: " DATABASE_URL
  echo ""
fi

if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}❌ DATABASE_URL이 비어있습니다. 종료합니다.${NC}"
  exit 1
fi

# ── psql 설치 확인 ───────────────────────────────────────────
if ! command -v psql &> /dev/null; then
  echo -e "${YELLOW}psql이 설치되어 있지 않습니다. 설치합니다...${NC}"
  
  if [[ "$OSTYPE" == "darwin"* ]]; then
    brew install postgresql
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    sudo apt-get install -y postgresql-client
  else
    echo -e "${RED}psql을 수동으로 설치해주세요: https://www.postgresql.org/download/${NC}"
    exit 1
  fi
fi

# ── 연결 테스트 ──────────────────────────────────────────────
echo -e "🔗 DB 연결 확인 중..."
if ! psql "$DATABASE_URL" -c "SELECT 1;" > /dev/null 2>&1; then
  echo -e "${RED}❌ DB 연결 실패. DATABASE_URL을 확인해주세요.${NC}"
  echo "   URL: ${DATABASE_URL:0:50}..."
  exit 1
fi
echo -e "${GREEN}✅ DB 연결 성공${NC}"
echo ""

# ── migration.sql 파일 확인 ──────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION_FILE="$SCRIPT_DIR/migration.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
  echo -e "${RED}❌ migration.sql 파일을 찾을 수 없습니다.${NC}"
  echo "   이 스크립트와 같은 폴더에 migration.sql이 있어야 합니다."
  exit 1
fi

# ── 마이그레이션 실행 ────────────────────────────────────────
echo -e "🚀 마이그레이션 실행 중..."
echo ""

psql "$DATABASE_URL" -f "$MIGRATION_FILE" 2>&1 | while IFS= read -r line; do
  if echo "$line" | grep -q "ERROR"; then
    echo -e "${RED}  $line${NC}"
  elif echo "$line" | grep -q "NOTICE\|완료"; then
    echo -e "${GREEN}  $line${NC}"
  else
    echo "  $line"
  fi
done

# ── Dave Ahn admin 설정 ──────────────────────────────────────
echo ""
echo -e "${YELLOW}👤 Admin 계정 설정${NC}"
echo "Dave Ahn 계정의 이메일 주소를 입력하세요:"
read -p "이메일: " ADMIN_EMAIL

if [ -n "$ADMIN_EMAIL" ]; then
  psql "$DATABASE_URL" <<-SQL
    INSERT INTO public.user_roles (user_id, role)
    SELECT id, 'admin'
    FROM auth.users
    WHERE email = '$ADMIN_EMAIL'
    ON CONFLICT (user_id, category) DO UPDATE SET role = 'admin';
SQL
  echo -e "${GREEN}✅ Admin 권한 설정 완료: $ADMIN_EMAIL${NC}"
else
  echo -e "${YELLOW}⚠️  이메일 미입력 — 나중에 수동으로 설정하세요${NC}"
fi

# ── 완료 ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅ 모든 마이그레이션 완료!          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""
echo "생성된 것들:"
echo "  ✓ user_roles     (RBAC 권한 테이블)"
echo "  ✓ audit_logs     (변경 이력 테이블 + 트리거)"
echo "  ✓ activities     (활동 타임라인 테이블)"
echo "  ✓ tasks          (태스크/리마인더 테이블)"
echo "  ✓ opportunities  (stage, probability 컬럼 추가)"
echo ""
echo "다음 단계: 컴포넌트 파일들을 프로젝트에 복사하세요."
echo ""
