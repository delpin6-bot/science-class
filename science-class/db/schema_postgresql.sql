-- =====================================================================
--  학생 학습 활동 모니터링 DB  (PostgreSQL 13+)
--  계층: academic_years(연도) 1─N schools(학교) 1─N students(학생) 1─N learning_activities(학습 활동)
--  보조: import_batches(명단 업로드 이력) 1─N students(마지막으로 반영된 업로드)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 명단 업로드 이력
--    같은 파일(내용 해시)을 두 번 올리는 실수를 막고, 몇 명이 새로 들어오고
--    갱신·제외되었는지 기록한다. 학생 행보다 먼저 만들어야 FK를 걸 수 있다.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_batches (
    import_id      BIGSERIAL    PRIMARY KEY,
    file_name      VARCHAR(255) NOT NULL,
    file_sha256    CHAR(64)     NOT NULL,                -- 파일 내용 해시(중복 업로드 판별)
    status         VARCHAR(12)  NOT NULL DEFAULT 'processing'
                   CHECK (status IN ('processing', 'success', 'partial', 'failed', 'superseded')),  -- superseded: --force 재반영으로 대체됨
    rows_total     INTEGER      NOT NULL DEFAULT 0,
    rows_inserted  INTEGER      NOT NULL DEFAULT 0,
    rows_updated   INTEGER      NOT NULL DEFAULT 0,
    rows_skipped   INTEGER      NOT NULL DEFAULT 0,
    errors         JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- [{row, reason}, ...]
    imported_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- 성공(또는 부분 성공)한 파일만 중복으로 본다. 실패한 파일은 고쳐서 다시 올릴 수 있게 한다.
CREATE UNIQUE INDEX IF NOT EXISTS ux_import_file_ok
    ON import_batches (file_sha256) WHERE status IN ('success', 'partial');

-- ---------------------------------------------------------------------
-- 1. 연도 (최상위 계층)
--    학년도 단위로 명단·학교가 바뀌므로 모든 데이터의 뿌리가 된다.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academic_years (
    year_id     SMALLSERIAL  PRIMARY KEY,
    year        SMALLINT     NOT NULL UNIQUE CHECK (year BETWEEN 2000 AND 2100),  -- 2024 등
    starts_on   DATE,                                     -- 학년도 시작일(선택)
    ends_on     DATE,                                     -- 학년도 종료일(선택)
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on > starts_on)
);

-- ---------------------------------------------------------------------
-- 2. 학교 (연도 하위)
--    '그 해의 학교'를 한 행으로 둔다. 같은 학교라도 연도가 다르면 다른 행이라
--    해마다 명단을 새로 올려도 지난 연도 기록이 섞이지 않는다.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schools (
    school_id    SERIAL       PRIMARY KEY,
    year_id      SMALLINT     NOT NULL REFERENCES academic_years (year_id) ON DELETE RESTRICT,
    school_name  VARCHAR(100) NOT NULL,
    school_code  VARCHAR(20),                             -- 표준학교코드 등(선택)
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_school_per_year UNIQUE (year_id, school_name)
);

-- ---------------------------------------------------------------------
-- 3. 학생 (학교 하위)
--    한 학교 안에서 (학년, 반, 번호)가 학생을 유일하게 가리키는 자연키.
--    업로드 때 이 키로 Upsert 한다(있으면 이름 등 갱신, 없으면 추가).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
    student_id      BIGSERIAL    PRIMARY KEY,
    school_id       INTEGER      NOT NULL REFERENCES schools (school_id) ON DELETE CASCADE,
    grade           SMALLINT     NOT NULL CHECK (grade BETWEEN 1 AND 6),
    class_no        SMALLINT     NOT NULL CHECK (class_no BETWEEN 1 AND 30),
    student_no      SMALLINT     NOT NULL CHECK (student_no BETWEEN 1 AND 60),
    name            VARCHAR(50)  NOT NULL,
    student_code    VARCHAR(30),                          -- 학번(선택)
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,   -- 전학 등으로 명단에서 빠지면 FALSE (기록은 보존)
    last_import_id  BIGINT       REFERENCES import_batches (import_id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_student_seat UNIQUE (school_id, grade, class_no, student_no)
);
CREATE INDEX IF NOT EXISTS ix_students_school_active ON students (school_id) WHERE is_active;

-- ---------------------------------------------------------------------
-- 4. 학습 활동 로그 (학생 하위, 가장 많이 쌓이는 테이블)
--    게임·가상실험·활동지·퀴즈 결과를 한 형식으로 기록한다.
--    detail(JSONB)에는 오답 개념, 힌트 사용, 헷갈린 답 등 활동별 세부값을 넣는다.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS learning_activities (
    activity_id      BIGSERIAL    PRIMARY KEY,
    student_id       BIGINT       NOT NULL REFERENCES students (student_id) ON DELETE CASCADE,
    occurred_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    activity_type    VARCHAR(20)  NOT NULL
                     CHECK (activity_type IN ('game', 'simulation', 'worksheet', 'quiz', 'video', 'etc')),
    content_key      VARCHAR(80)  NOT NULL,               -- 예: 'shootdown'(개념 격추), '옴의_법칙'
    unit_name        VARCHAR(100),                        -- 대단원
    lesson_title     VARCHAR(150),                        -- 차시명
    lesson_code      VARCHAR(20),                         -- QR 차시 코드(q)
    score            NUMERIC(8,2),
    accuracy_pct     NUMERIC(5,2) CHECK (accuracy_pct BETWEEN 0 AND 100),
    progress_pct     NUMERIC(5,2) CHECK (progress_pct BETWEEN 0 AND 100),  -- 이 활동의 완료 정도
    duration_sec     INTEGER      CHECK (duration_sec >= 0),
    detail           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    client_event_id  UUID         UNIQUE,                 -- 같은 기록이 두 번 전송돼도 한 번만 저장
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- 모니터링의 핵심 경로: "이 학생들의 최근 N일 활동" → (학생, 시각 내림차순) 복합 인덱스
CREATE INDEX IF NOT EXISTS ix_act_student_time ON learning_activities (student_id, occurred_at DESC);
-- 시간 순으로만 쌓이는 로그라 BRIN이 작고 빠르다(기간 전체 통계용)
CREATE INDEX IF NOT EXISTS ix_act_time_brin    ON learning_activities USING brin (occurred_at);

COMMENT ON TABLE academic_years      IS '1단계: 학년도';
COMMENT ON TABLE schools             IS '2단계: 연도별 학교';
COMMENT ON TABLE students            IS '3단계: 학교별 학생 (학년·반·번호 자연키)';
COMMENT ON TABLE learning_activities IS '4단계: 학습 활동 로그';
COMMENT ON TABLE import_batches      IS '명단 업로드 이력(중복 파일 방지·결과 기록)';
