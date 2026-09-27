#!/bin/bash
# 브라우저 통합 시험 (개발용). 필요: 비어 있는 시험용 PostgreSQL(PG_DSN), python3, playwright(chromium)
#   PG_DSN="host=127.0.0.1 port=5432 user=postgres password=... dbname=test" ./run_e2e.sh
# ⚠ 시험용 DB에서만: 스키마를 만들고 시험 데이터를 넣습니다.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"; DB="$ROOT/db"
: "${PG_DSN:?PG_DSN 을 시험용 DB로 지정하세요}"
TID=11111111-2222-3333-4444-555555555555
python3 - <<PY
import psycopg2; c=psycopg2.connect("$PG_DSN"); c.autocommit=True; q=c.cursor()
for t in ["student_tokens","teacher_schools","teachers","learning_activities","students","schools","academic_years","import_batches"]: q.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
q.execute(open("$DB/tests/supabase_stub.sql").read()); q.execute(open("$DB/schema_postgresql.sql").read()); q.execute(open("$DB/supabase_api.sql").read())
q.execute("insert into teachers values ('$TID','김과학',now())"); q.execute("insert into teacher_schools values ('$TID','원덕중학교')"); c.close()
PY
SITE="$(mktemp -d)"; cp -r "$ROOT"/. "$SITE"/
sed -i 's#url: ""#url: "http://127.0.0.1:8870"#; s#anonKey: ""#anonKey: "anon-test"#; s#year: 2026#year: 2024#' "$SITE/sounds/kjs-db-config.js"
MOCK_TEST=1 MOCK_USERS='{"teacher@school.kr":["pw1234","'$TID'"]}' python3 "$HERE/mock_supabase.py" 8870 & MOCK=$!
(cd "$SITE" && python3 -m http.server 8871 >/dev/null 2>&1) & WEB=$!
trap 'kill $MOCK $WEB 2>/dev/null; rm -rf "$SITE"' EXIT
sleep 1.5; python3 -u "$HERE/e2e_site_test.py"
