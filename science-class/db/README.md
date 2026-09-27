# 학습 기록 DB 설치 안내 (Supabase)

이 폴더는 과학수업 서랍의 **학생 학습 기록**을 저장하는 데이터베이스입니다.
설치하지 않아도 사이트는 지금처럼 잘 동작합니다(기록만 남지 않음). 설치는 학기 초 한 번, 약 20분 걸립니다.

## 준비물
- Supabase 계정 (https://supabase.com, 무료 플랜으로 충분)
- 이 저장소가 GitHub Pages로 공개된 상태

## 1단계 · 프로젝트 만들기
1. Supabase 로그인 → **New project**
2. 이름(예: `science-class`), DB 비밀번호(따로 보관), 지역 **Northeast Asia (Seoul)** → Create

## 2단계 · 테이블과 서버 함수 만들기
1. 왼쪽 메뉴 **SQL Editor** → New query
2. `db/schema_postgresql.sql` 내용을 붙여 넣고 **Run**
3. 새 쿼리에 `db/supabase_api.sql` 내용을 붙여 넣고 **Run**

## 3단계 · 교사 계정 만들기
1. 왼쪽 메뉴 **Authentication → Users → Add user → Create new user**
   - 이메일·비밀번호 입력, **Auto Confirm User** 체크 → Create
2. 만든 사용자를 눌러 **User UID**를 복사
3. SQL Editor 에서 실행 (UID·이름·학교명을 바꿔서)
```sql
INSERT INTO teachers (user_id, name) VALUES ('복사한-UID', '김과학');
INSERT INTO teacher_schools (user_id, school_name) VALUES ('복사한-UID', '원덕중학교');
```
   - 여러 학교를 담당하면 `teacher_schools` 에 한 줄씩 더 넣습니다.
4. 학생·외부인이 교사 계정을 만들 수 없도록 **Authentication → Providers → Email → "Allow new users to sign up" 끄기**

## 4단계 · 사이트에 연결
1. **Project Settings → API** 에서 `Project URL` 과 `anon public` 키 복사
2. 저장소의 `sounds/kjs-db-config.js` 를 열어 채우고 커밋
```js
window.KJS_DB_CONFIG = {
  url: "https://abcd1234.supabase.co",
  anonKey: "eyJhbGciOi...(anon public 키)",
  year: 2026,
  school: "원덕중학교"
};
```
> ⚠ **service_role 키는 절대 넣지 마세요.** 모든 보안을 우회하는 관리자 키입니다. anon 키는 공개용이라 GitHub에 올라가도 괜찮습니다.

## 5단계 · 확인
1. 사이트에서 서랍 → **🧰 도구 → 👥 학생 명단 올리기** → 교사 로그인 → 명단 엑셀 올리기
2. 학생 기기에서 게임을 열고 **🙋 로그인** → 학년·반·번호·이름 → 게임 한 판
3. **🧰 도구 → 📊 학습 모니터링** 에서 그 학생 기록이 보이면 완료

## 명단 파일 형식
- 필요한 열: **학년, 반, 번호, 이름** (학번 선택)
- 연도·학교 열이 없으면 화면에서 고른 기본값을 씁니다.
- `3학년`, `05번` 처럼 글자가 섞여도 숫자로 읽습니다. 한글 윈도우(CP949) 텍스트도 됩니다.
- 같은 학년·반·번호는 새로 넣지 않고 이름을 갱신합니다.
- "이 파일의 학년·반에 없는 학생은 비활성"을 켜면 전학생을 정리합니다(기록은 보존).

## 자주 하는 관리 작업 (SQL Editor)
```sql
-- 학생 기기 등록 모두 해제(학년 초 기기 정리)
UPDATE student_tokens SET revoked = TRUE;

-- 특정 학생 기기만 해제
UPDATE student_tokens SET revoked = TRUE
WHERE student_id = (SELECT student_id FROM students s JOIN schools sc USING (school_id)
                    JOIN academic_years y USING (year_id)
                    WHERE y.year = 2026 AND sc.school_name = '원덕중학교' AND grade = 2 AND class_no = 1 AND student_no = 7);

-- 연도가 지난 활동 기록 삭제(보관 기간 정책에 맞춰)
DELETE FROM learning_activities WHERE occurred_at < now() - INTERVAL '1 year';
```

## 개인정보 안내
- 저장하는 학생 정보는 **학년·반·번호·이름**과 학습 기록뿐입니다. 연락처·생년월일 등은 저장하지 않습니다.
- 학교 개인정보 처리 절차(수집·이용 안내, 보관 기간)에 맞춰 운영하고, 학년이 끝나면 기록 정리 기준을 정해 두세요.
- 학생 등록은 명단과 학년·반·번호·이름이 모두 맞아야 되지만, 이름을 아는 친구가 대신 등록할 수는 있습니다. 공용 기기는 수업 후 🙋 버튼으로 로그아웃하도록 안내하세요.

## 파일 설명
| 파일 | 설명 |
|---|---|
| `schema_postgresql.sql` | 테이블 5개(연도·학교·학생·학습 활동·업로드 이력) |
| `supabase_api.sql` | 교사·토큰 테이블, 보안(RLS), 서버 함수 6개 |
| `monitoring_queries.sql` | 모니터링 SQL 원본(파이썬 도구·직접 조회용) |
| `tools/` | 파이썬 도구: 명단 업로드·주간 보고서(엑셀)·활동 기록. `DATABASE_URL` 에 Supabase 연결 문자열(Project Settings → Database)을 넣어 사용 |
| `tests/` | 시험: SQL 권한·함수(`sql_security_test.py`), 브라우저 통합(`run_e2e.sh`), 파이썬 도구(`tools/test_all.py`) |

## 서버 함수 요약
| 함수 | 누가 | 하는 일 |
|---|---|---|
| `school_list()` | 누구나 | 등록 화면의 학교 목록(이름·연도) |
| `student_sign_in(...)` | 누구나 | 명단 확인 후 기기 토큰 발급 |
| `log_activities(token, events)` | 토큰 가진 기기 | 학습 활동 저장(검증·중복 방지·기기 시계 보정) |
| `teacher_me()` | 교사 | 이름·담당 학교·연도 |
| `teacher_monitor(year, school, …)` | 담당 교사 | 학생별 7일 활동·진도·최근 5건, 학급 요약, 학급별 오답 개념 TOP 5 |
| `teacher_upsert_roster(...)` | 교사 | 명단 업로드(연도·학교 자동 생성, Upsert, 반 단위 비활성, 중복 파일 차단) |
