-- =====================================================================
--  과학수업 서랍 × 학습 모니터링 DB — Supabase(PostgreSQL) API 계층
--  실행 순서: 1) schema_postgresql.sql  2) 이 파일
--
--  원칙
--  · 웹 화면(GitHub Pages)은 테이블에 직접 접근하지 못한다(RLS 켜고 정책 없음).
--  · 화면은 아래 함수(RPC)만 부른다. 함수는 SECURITY DEFINER 로 실행되며 입력을 스스로 검증한다.
--  · 학생 함수(anon 허용): school_list, student_sign_in, log_activities
--  · 교사 함수(로그인 + teachers 등록 필요): teacher_me, teacher_monitor, teacher_upsert_roster
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. 교사 계정과 담당 학교
--    Supabase Auth 사용자(auth.users.id)를 교사로 등록하고, 볼 수 있는 학교를 정한다.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teachers (
    user_id     UUID         PRIMARY KEY,            -- auth.users.id
    name        VARCHAR(50)  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS teacher_schools (
    user_id      UUID         NOT NULL REFERENCES teachers (user_id) ON DELETE CASCADE,
    school_name  VARCHAR(100) NOT NULL,              -- 연도와 관계없이 이 학교를 담당
    PRIMARY KEY (user_id, school_name)
);

-- ---------------------------------------------------------------------
-- B. 학생 기기 토큰
--    학생이 학년·반·번호·이름으로 등록하면 기기마다 토큰을 준다.
--    토큰만 있으면 그 학생 이름으로 활동을 기록할 수 있고, 교사가 언제든 폐기할 수 있다.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_tokens (
    token        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id   BIGINT       NOT NULL REFERENCES students (student_id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked      BOOLEAN      NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS ix_tokens_student ON student_tokens (student_id);

-- ---------------------------------------------------------------------
-- C. 직접 접근 차단 (RLS 켜고 정책을 만들지 않음 → anon·authenticated 는 테이블을 못 읽고 못 씀)
-- ---------------------------------------------------------------------
ALTER TABLE academic_years      ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools             ENABLE ROW LEVEL SECURITY;
ALTER TABLE students            ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_schools     ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_tokens      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON academic_years, schools, students, learning_activities, import_batches,
              teachers, teacher_schools, student_tokens FROM anon, authenticated;

-- 교사인지 확인 (내부용)
CREATE OR REPLACE FUNCTION _is_teacher_of(p_school TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM teacher_schools
                 WHERE user_id = auth.uid() AND school_name = p_school);
$$;

-- =====================================================================
-- 학생 함수
-- =====================================================================

-- 1) 등록 화면의 학교 선택 목록 (학교 이름과 연도만 공개)
CREATE OR REPLACE FUNCTION school_list() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('year', y.year, 'school_name', s.school_name)
                            ORDER BY y.year DESC, s.school_name), '[]'::jsonb)
  FROM schools s JOIN academic_years y ON y.year_id = s.year_id
  WHERE y.year >= EXTRACT(YEAR FROM now())::int - 1;
$$;

-- 2) 학생 등록: 학년·반·번호가 명단과 맞고 이름이 같으면 기기 토큰 발급
CREATE OR REPLACE FUNCTION student_sign_in(p_year INT, p_school TEXT, p_grade INT, p_class INT,
                                           p_no INT, p_name TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sid BIGINT; v_name TEXT; v_token UUID;
BEGIN
  SELECT st.student_id, st.name INTO v_sid, v_name
  FROM students st JOIN schools sc ON sc.school_id = st.school_id
                   JOIN academic_years y ON y.year_id = sc.year_id
  WHERE y.year = p_year AND sc.school_name = p_school AND st.is_active
    AND st.grade = p_grade AND st.class_no = p_class AND st.student_no = p_no;
  -- 명단에 없거나 이름이 다르면 같은 메시지(어느 쪽이 틀렸는지 알려 주지 않음)
  IF v_sid IS NULL OR regexp_replace(v_name, '\s', '', 'g') <> regexp_replace(COALESCE(p_name, ''), '\s', '', 'g') THEN
    RETURN jsonb_build_object('ok', false, 'error', '명단에서 찾을 수 없어요. 학년·반·번호와 이름을 확인해 주세요.');
  END IF;
  INSERT INTO student_tokens (student_id) VALUES (v_sid) RETURNING token INTO v_token;
  RETURN jsonb_build_object('ok', true, 'token', v_token,
         'student', jsonb_build_object('year', p_year, 'school_name', p_school, 'grade', p_grade,
                                       'class_no', p_class, 'student_no', p_no, 'name', v_name));
END $$;

-- 3) 활동 기록: 토큰 학생의 활동을 묶음으로 저장. 잘못된 기록만 거절하고 나머지는 저장.
CREATE OR REPLACE FUNCTION log_activities(p_token UUID, p_events JSONB) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sid BIGINT; e JSONB; i INT := 0; v_ins INT := 0; v_dup INT := 0; v_rej JSONB := '[]'::jsonb;
  v_type TEXT; v_at TIMESTAMPTZ; v_prog NUMERIC; v_acc NUMERIC; v_id BIGINT;
BEGIN
  SELECT t.student_id INTO v_sid FROM student_tokens t JOIN students s USING (student_id)
  WHERE t.token = p_token AND NOT t.revoked AND s.is_active;
  IF v_sid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;
  IF jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'error', '한 번에 1~200건까지 보낼 수 있어요.');
  END IF;
  UPDATE student_tokens SET last_used_at = now() WHERE token = p_token;

  FOR e IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    BEGIN
      v_type := e->>'activity_type';
      IF v_type NOT IN ('game','simulation','worksheet','quiz','video','etc') THEN
        RAISE EXCEPTION '활동 유형 오류(%)', v_type;
      END IF;
      IF COALESCE(e->>'content_key', '') = '' THEN RAISE EXCEPTION 'content_key 누락'; END IF;
      v_at   := COALESCE((e->>'occurred_at')::timestamptz, now());
      IF v_at > now() + INTERVAL '10 minutes' OR v_at < now() - INTERVAL '400 days' THEN
        RAISE EXCEPTION '시각 범위 오류(%)', v_at;
      END IF;
      v_at   := LEAST(v_at, now());      -- 기기 시계가 조금 빠르면 서버 시각으로 맞춤(모니터링에서 빠지지 않게)
      v_prog := NULLIF(e->>'progress_pct', '')::numeric;
      v_acc  := NULLIF(e->>'accuracy_pct', '')::numeric;
      IF v_prog NOT BETWEEN 0 AND 100 OR v_acc NOT BETWEEN 0 AND 100 THEN
        RAISE EXCEPTION '백분율은 0~100';
      END IF;
      INSERT INTO learning_activities (student_id, occurred_at, activity_type, content_key, unit_name,
             lesson_title, lesson_code, score, accuracy_pct, progress_pct, duration_sec, detail, client_event_id)
      VALUES (v_sid, v_at, v_type, left(e->>'content_key', 80), left(e->>'unit_name', 100),
             left(e->>'lesson_title', 150), left(e->>'lesson_code', 20), NULLIF(e->>'score', '')::numeric,
             v_acc, v_prog, GREATEST(0, NULLIF(e->>'duration_sec', '')::int),
             COALESCE(e->'detail', '{}'::jsonb), NULLIF(e->>'client_event_id', '')::uuid)
      ON CONFLICT (client_event_id) DO NOTHING
      RETURNING activity_id INTO v_id;
      IF v_id IS NULL THEN v_dup := v_dup + 1; ELSE v_ins := v_ins + 1; END IF;
      v_id := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_rej := v_rej || jsonb_build_object('index', i, 'reason', SQLERRM);
    END;
    i := i + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'inserted', v_ins, 'duplicates', v_dup, 'rejected', v_rej);
END $$;

-- =====================================================================
-- 교사 함수
-- =====================================================================

-- 4) 내 정보와 담당 학교
CREATE OR REPLACE FUNCTION teacher_me() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'is_teacher', EXISTS (SELECT 1 FROM teachers WHERE user_id = auth.uid()),
    'name',  (SELECT name FROM teachers WHERE user_id = auth.uid()),
    'schools', COALESCE((SELECT jsonb_agg(school_name ORDER BY school_name) FROM teacher_schools WHERE user_id = auth.uid()), '[]'::jsonb),
    'years', COALESCE((SELECT jsonb_agg(DISTINCT y.year ORDER BY y.year DESC)
                       FROM academic_years y JOIN schools s ON s.year_id = y.year_id
                       JOIN teacher_schools ts ON ts.school_name = s.school_name AND ts.user_id = auth.uid()), '[]'::jsonb));
$$;

-- 5) 모니터링: 학생별 최근 7일·평균 진도율·최근 5건 + 학급 요약 + 학급별 오답 개념 TOP
--    (monitoring_queries.sql 의 [Q1][Q2] 와 같은 계산)
CREATE OR REPLACE FUNCTION teacher_monitor(p_year INT, p_school TEXT, p_as_of TIMESTAMPTZ DEFAULT now(),
                                           p_tz TEXT DEFAULT 'Asia/Seoul', p_days INT DEFAULT 7) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from TIMESTAMPTZ := p_as_of - make_interval(days => LEAST(GREATEST(p_days, 1), 60)); r JSONB;
BEGIN
  IF NOT _is_teacher_of(p_school) THEN
    RETURN jsonb_build_object('ok', false, 'error', '이 학교를 볼 권한이 없어요.');
  END IF;
  WITH target AS (
      SELECT st.student_id, st.grade, st.class_no, st.student_no, st.name
      FROM students st JOIN schools sc ON sc.school_id = st.school_id
                       JOIN academic_years y ON y.year_id = sc.year_id
      WHERE y.year = p_year AND sc.school_name = p_school AND st.is_active),
  wk AS (
      SELECT a.* FROM learning_activities a JOIN target t USING (student_id)
      WHERE a.occurred_at >= v_from AND a.occurred_at < p_as_of),
  ws AS (
      SELECT student_id, COUNT(*) n, ROUND(COALESCE(SUM(duration_sec), 0) / 60.0, 1) mins,
             ROUND(AVG(score), 1) sc, ROUND(AVG(accuracy_pct), 1) acc,
             COUNT(DISTINCT (occurred_at AT TIME ZONE p_tz)::date) days, MAX(occurred_at) last_at,
             (ARRAY_AGG(jsonb_build_object('at', to_char(occurred_at AT TIME ZONE p_tz, 'MM-DD HH24:MI'),
                 'type', activity_type, 'content', content_key, 'lesson', lesson_title,
                 'score', score, 'accuracy', accuracy_pct, 'progress', progress_pct) ORDER BY occurred_at DESC))[1:5] recent
      FROM wk GROUP BY student_id),
  best AS (
      SELECT a.student_id, MAX(a.progress_pct) b
      FROM learning_activities a JOIN target t USING (student_id)
      WHERE a.progress_pct IS NOT NULL AND a.occurred_at < p_as_of
      GROUP BY a.student_id, a.content_key, COALESCE(a.lesson_code, a.lesson_title, '')),
  pr AS (SELECT student_id, ROUND(AVG(b), 1) avgp, COUNT(*) started, COUNT(*) FILTER (WHERE b >= 100) done
         FROM best GROUP BY student_id),
  rows AS (
      SELECT t.grade, t.class_no, t.student_no, t.name, t.student_id,
             COALESCE(ws.n, 0) activities, COALESCE(ws.days, 0) active_days, COALESCE(ws.mins, 0) minutes,
             ws.sc avg_score, ws.acc avg_accuracy, COALESCE(pr.avgp, 0) avg_progress,
             COALESCE(pr.started, 0) items_started, COALESCE(pr.done, 0) items_completed,
             to_char(ws.last_at AT TIME ZONE p_tz, 'YYYY-MM-DD HH24:MI') last_activity,
             CASE WHEN ws.student_id IS NULL THEN '미참여' WHEN ws.days = 1 THEN '저참여' ELSE '참여' END status,
             COALESCE(to_jsonb(ws.recent), '[]'::jsonb) recent
      FROM target t LEFT JOIN ws USING (student_id) LEFT JOIN pr USING (student_id)),
  classes AS (
      SELECT grade, class_no, COUNT(*) students, COUNT(*) FILTER (WHERE activities > 0) active,
             ROUND(100.0 * COUNT(*) FILTER (WHERE activities > 0) / NULLIF(COUNT(*), 0), 1) participation,
             ROUND(AVG(avg_progress), 1) avg_progress, ROUND(AVG(avg_score), 1) avg_score
      FROM rows GROUP BY grade, class_no),
  wrong AS (   -- 게임이 보낸 detail.wrong(틀린 개념) 을 학급별로 모아 가장 많이 틀린 개념
      SELECT t.grade, t.class_no, w.concept, COUNT(*) cnt, COUNT(DISTINCT t.student_id) students
      FROM wk JOIN target t USING (student_id)
      CROSS JOIN LATERAL jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(wk.detail->'wrong') = 'array' THEN wk.detail->'wrong' ELSE '[]'::jsonb END) AS w(concept)
      GROUP BY t.grade, t.class_no, w.concept),
  wrong_top AS (
      SELECT grade, class_no, jsonb_agg(jsonb_build_object('concept', concept, 'count', cnt, 'students', students)
                                         ORDER BY cnt DESC, concept) FILTER (WHERE rk <= 5) top
      FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY grade, class_no ORDER BY cnt DESC, concept) rk FROM wrong) x
      GROUP BY grade, class_no)
  SELECT jsonb_build_object(
      'ok', true, 'year', p_year, 'school', p_school, 'days', p_days,
      'as_of', to_char(p_as_of AT TIME ZONE p_tz, 'YYYY-MM-DD HH24:MI'),
      'students', COALESCE((SELECT jsonb_agg(to_jsonb(r2) - 'student_id' || jsonb_build_object('id', r2.student_id)
                                             ORDER BY grade, class_no, student_no) FROM rows r2), '[]'::jsonb),
      'classes', COALESCE((SELECT jsonb_agg(to_jsonb(c) || jsonb_build_object('wrong_top', COALESCE(w.top, '[]'::jsonb))
                                            ORDER BY c.grade, c.class_no)
                           FROM classes c LEFT JOIN wrong_top w USING (grade, class_no)), '[]'::jsonb))
  INTO r;
  RETURN r;
END $$;

-- 6) 명단 업로드: 화면에서 읽어 검증한 행을 받아 연도·학교 자동 생성 + 학생 Upsert
--    p_rows: [{year, school_name, grade, class_no, student_no, name, student_code?}]
CREATE OR REPLACE FUNCTION teacher_upsert_roster(p_file_name TEXT, p_sha256 TEXT, p_rows JSONB,
                                                 p_deactivate_missing BOOLEAN DEFAULT FALSE,
                                                 p_force BOOLEAN DEFAULT FALSE) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_import BIGINT; v_ins INT := 0; v_upd INT := 0; v_deact INT := 0; v_bad JSONB := '[]'::jsonb;
        v_prev RECORD; v_total INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM teachers WHERE user_id = auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', '교사 계정만 명단을 올릴 수 있어요.');
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 OR jsonb_array_length(p_rows) > 5000 THEN
    RETURN jsonb_build_object('ok', false, 'error', '학생 행이 없거나 너무 많아요(최대 5,000행).');
  END IF;
  v_total := jsonb_array_length(p_rows);

  -- 검증된 행만 임시 표에 (학교 권한·형식·범위)
  DROP TABLE IF EXISTS _r;
  CREATE TEMP TABLE _r ON COMMIT DROP AS
  SELECT ord - 1 AS idx, (x->>'year')::int AS year, trim(x->>'school_name') AS school_name,
         (x->>'grade')::int AS grade, (x->>'class_no')::int AS class_no, (x->>'student_no')::int AS student_no,
         left(trim(x->>'name'), 50) AS name, NULLIF(trim(x->>'student_code'), '') AS student_code
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(x, ord)
  WHERE (x->>'year') ~ '^\d{4}$' AND (x->>'grade') ~ '^\d+$' AND (x->>'class_no') ~ '^\d+$'
    AND (x->>'student_no') ~ '^\d+$' AND COALESCE(trim(x->>'name'), '') <> '';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('index', g, 'reason', '형식 오류(연도 4자리·학년·반·번호 숫자·이름 필수)')), '[]'::jsonb)
    INTO v_bad FROM generate_series(0, v_total - 1) g WHERE g NOT IN (SELECT idx FROM _r);
  SELECT v_bad || COALESCE(jsonb_agg(jsonb_build_object('index', idx, 'reason',
           CASE WHEN NOT _is_teacher_of(school_name) THEN '담당 학교가 아님(' || school_name || ')'
                ELSE '값 범위 오류' END)), '[]'::jsonb) INTO v_bad
  FROM _r WHERE NOT _is_teacher_of(school_name) OR year NOT BETWEEN 2000 AND 2100 OR grade NOT BETWEEN 1 AND 6
            OR class_no NOT BETWEEN 1 AND 30 OR student_no NOT BETWEEN 1 AND 60;
  DELETE FROM _r WHERE NOT _is_teacher_of(school_name) OR year NOT BETWEEN 2000 AND 2100 OR grade NOT BETWEEN 1 AND 6
                    OR class_no NOT BETWEEN 1 AND 30 OR student_no NOT BETWEEN 1 AND 60;
  IF NOT EXISTS (SELECT 1 FROM _r) THEN
    RETURN jsonb_build_object('ok', false, 'error', '저장할 수 있는 행이 없어요.', 'rejected', v_bad);
  END IF;

  -- 같은 파일 재업로드 방지
  SELECT import_id, imported_at INTO v_prev FROM import_batches
  WHERE file_sha256 = p_sha256 AND status IN ('success', 'partial') LIMIT 1;
  IF FOUND AND NOT p_force THEN
    RETURN jsonb_build_object('ok', false, 'duplicate', true,
      'error', format('이미 올린 파일이에요(업로드 #%s, %s). 다시 반영하려면 "강제 재반영"을 켜세요.',
                      v_prev.import_id, to_char(v_prev.imported_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')));
  END IF;
  IF FOUND THEN UPDATE import_batches SET status = 'superseded' WHERE file_sha256 = p_sha256 AND status IN ('success','partial'); END IF;

  INSERT INTO import_batches (file_name, file_sha256, rows_total) VALUES (p_file_name, p_sha256, v_total)
  RETURNING import_id INTO v_import;

  INSERT INTO academic_years (year) SELECT DISTINCT year FROM _r ON CONFLICT (year) DO NOTHING;
  INSERT INTO schools (year_id, school_name)
  SELECT DISTINCT y.year_id, r.school_name FROM _r r JOIN academic_years y USING (year)
  ON CONFLICT ON CONSTRAINT uq_school_per_year DO NOTHING;

  WITH src AS (
      SELECT DISTINCT ON (s.school_id, r.grade, r.class_no, r.student_no)
             s.school_id, r.grade, r.class_no, r.student_no, r.name, r.student_code
      FROM _r r JOIN academic_years y USING (year) JOIN schools s ON s.year_id = y.year_id AND s.school_name = r.school_name
      ORDER BY s.school_id, r.grade, r.class_no, r.student_no, r.idx DESC),      -- 파일 안 중복: 뒤 행 사용
  up AS (
      INSERT INTO students (school_id, grade, class_no, student_no, name, student_code, is_active, last_import_id)
      SELECT school_id, grade, class_no, student_no, name, student_code, TRUE, v_import FROM src
      ON CONFLICT ON CONSTRAINT uq_student_seat DO UPDATE
        SET name = EXCLUDED.name, student_code = COALESCE(EXCLUDED.student_code, students.student_code),
            is_active = TRUE, last_import_id = EXCLUDED.last_import_id, updated_at = now()
      RETURNING (xmax = 0) AS inserted)
  SELECT COUNT(*) FILTER (WHERE inserted), COUNT(*) FILTER (WHERE NOT inserted) INTO v_ins, v_upd FROM up;

  IF p_deactivate_missing THEN    -- 파일에 들어 있는 학년·반 안에서만
    UPDATE students st SET is_active = FALSE, updated_at = now()
    FROM schools s JOIN academic_years y ON y.year_id = s.year_id
    WHERE st.school_id = s.school_id AND st.is_active
      AND EXISTS (SELECT 1 FROM _r r WHERE r.year = y.year AND r.school_name = s.school_name
                                     AND r.grade = st.grade AND r.class_no = st.class_no)
      AND NOT EXISTS (SELECT 1 FROM _r r WHERE r.year = y.year AND r.school_name = s.school_name
                      AND r.grade = st.grade AND r.class_no = st.class_no AND r.student_no = st.student_no);
    GET DIAGNOSTICS v_deact = ROW_COUNT;
  END IF;

  UPDATE import_batches SET status = CASE WHEN jsonb_array_length(v_bad) > 0 THEN 'partial' ELSE 'success' END,
         rows_inserted = v_ins, rows_updated = v_upd, rows_skipped = jsonb_array_length(v_bad), errors = v_bad
  WHERE import_id = v_import;
  RETURN jsonb_build_object('ok', true, 'import_id', v_import, 'total', v_total, 'inserted', v_ins,
                            'updated', v_upd, 'deactivated', v_deact, 'rejected', v_bad);
END $$;

-- =====================================================================
-- 실행 권한: 기본(PUBLIC) 권한을 빼고 필요한 역할에만 준다
-- =====================================================================
REVOKE EXECUTE ON FUNCTION _is_teacher_of(TEXT), school_list(), student_sign_in(INT, TEXT, INT, INT, INT, TEXT),
       log_activities(UUID, JSONB), teacher_me(), teacher_monitor(INT, TEXT, TIMESTAMPTZ, TEXT, INT),
       teacher_upsert_roster(TEXT, TEXT, JSONB, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION school_list(), student_sign_in(INT, TEXT, INT, INT, INT, TEXT),
       log_activities(UUID, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION teacher_me(), teacher_monitor(INT, TEXT, TIMESTAMPTZ, TEXT, INT),
       teacher_upsert_roster(TEXT, TEXT, JSONB, BOOLEAN, BOOLEAN) TO authenticated;
