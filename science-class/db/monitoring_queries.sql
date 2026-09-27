-- =====================================================================
--  모니터링 쿼리 (PostgreSQL)
--  매개변수: :year (예 2024), :school_name (예 '원덕중학교'), :as_of (기준 시각, 보통 now()),
--            :tz (표시·날짜 계산 시간대, 예 'Asia/Seoul')
--  psql 에서 직접 실행할 때는 :year → 2024, :school_name → '원덕중학교', :as_of → now() 로 바꿔 넣으면 된다.
-- =====================================================================

-- [Q1] 학생별 한눈에 보기: 최근 7일 활동 + 누적 평균 진도율 + 최근 활동 5건
--  - 대상 학생을 먼저 좁힌 뒤(연도·학교 → 학생) 활동 로그는 (student_id, occurred_at) 인덱스로만 읽는다.
--  - 활동이 없는 학생도 LEFT JOIN 으로 모두 나오고 status = '미참여'.
--  - 평균 진도율: 학습 항목(콘텐츠+차시)별 '최고' 진도의 평균. 같은 차시를 여러 번 해도 부풀지 않는다.
WITH target_students AS (
    SELECT st.student_id, st.grade, st.class_no, st.student_no, st.name
    FROM   students st
    JOIN   schools        sc ON sc.school_id = st.school_id
    JOIN   academic_years y  ON y.year_id    = sc.year_id
    WHERE  y.year = :year
      AND  sc.school_name = :school_name
      AND  st.is_active
),
week_acts AS (                                   -- 최근 7일 활동
    SELECT a.student_id, a.occurred_at, a.activity_type, a.content_key, a.lesson_title,
           a.score, a.accuracy_pct, a.progress_pct, a.duration_sec
    FROM   learning_activities a
    JOIN   target_students t ON t.student_id = a.student_id
    WHERE  a.occurred_at >= CAST(:as_of AS timestamptz) - INTERVAL '7 days'
      AND  a.occurred_at <  CAST(:as_of AS timestamptz)
),
week_summary AS (
    SELECT student_id,
           COUNT(*)                                          AS activities_7d,
           ROUND(COALESCE(SUM(duration_sec), 0) / 60.0, 1)   AS minutes_7d,
           ROUND(AVG(score), 1)                              AS avg_score_7d,
           ROUND(AVG(accuracy_pct), 1)                       AS avg_accuracy_7d,
           COUNT(DISTINCT (occurred_at AT TIME ZONE :tz)::date) AS active_days_7d,   -- 한국 날짜 기준
           MAX(occurred_at)                                  AS last_activity_at,
           array_to_json((ARRAY_AGG(json_build_object(
               'at',       to_char(occurred_at AT TIME ZONE :tz, 'MM-DD HH24:MI'),
               'type',     activity_type,
               'content',  content_key,
               'lesson',   lesson_title,
               'score',    score,
               'progress', progress_pct) ORDER BY occurred_at DESC))[1:5]) AS recent_5
    FROM   week_acts
    GROUP  BY student_id
),
item_best AS (                                   -- 학습 항목별 최고 진도 (누적, 기준 시각까지)
    SELECT a.student_id,
           a.content_key,
           COALESCE(a.lesson_code, a.lesson_title, '') AS item,
           MAX(a.progress_pct)                         AS best_pct
    FROM   learning_activities a
    JOIN   target_students t ON t.student_id = a.student_id
    WHERE  a.progress_pct IS NOT NULL
      AND  a.occurred_at < CAST(:as_of AS timestamptz)
    GROUP  BY a.student_id, a.content_key, COALESCE(a.lesson_code, a.lesson_title, '')
),
progress AS (
    SELECT student_id,
           ROUND(AVG(best_pct), 1)                       AS avg_progress_pct,
           COUNT(*)                                      AS items_started,
           COUNT(*) FILTER (WHERE best_pct >= 100)       AS items_completed
    FROM   item_best
    GROUP  BY student_id
)
SELECT t.grade, t.class_no, t.student_no, t.name,
       COALESCE(w.activities_7d, 0)    AS activities_7d,
       COALESCE(w.active_days_7d, 0)   AS active_days_7d,
       COALESCE(w.minutes_7d, 0)       AS minutes_7d,
       w.avg_score_7d,
       w.avg_accuracy_7d,
       COALESCE(p.avg_progress_pct, 0) AS avg_progress_pct,
       COALESCE(p.items_started, 0)    AS items_started,
       COALESCE(p.items_completed, 0)  AS items_completed,
       to_char(w.last_activity_at AT TIME ZONE :tz, 'YYYY-MM-DD HH24:MI') AS last_activity_at,
       CASE WHEN w.student_id IS NULL        THEN '미참여'
            WHEN w.active_days_7d = 1        THEN '저참여'
            ELSE '참여' END             AS status,
       w.recent_5
FROM   target_students t
LEFT   JOIN week_summary w ON w.student_id = t.student_id
LEFT   JOIN progress     p ON p.student_id = t.student_id
ORDER  BY t.grade, t.class_no, t.student_no;


-- [Q2] 학급별 요약: 참여율·평균 진도율 (교사용 대시보드 첫 화면)
WITH target_students AS (
    SELECT st.student_id, st.grade, st.class_no
    FROM   students st
    JOIN   schools sc        ON sc.school_id = st.school_id
    JOIN   academic_years y  ON y.year_id    = sc.year_id
    WHERE  y.year = :year AND sc.school_name = :school_name AND st.is_active
),
week_active AS (
    SELECT DISTINCT a.student_id
    FROM   learning_activities a
    JOIN   target_students t ON t.student_id = a.student_id
    WHERE  a.occurred_at >= CAST(:as_of AS timestamptz) - INTERVAL '7 days'
      AND  a.occurred_at <  CAST(:as_of AS timestamptz)
),
item_best AS (
    SELECT a.student_id, MAX(a.progress_pct) AS best_pct
    FROM   learning_activities a
    JOIN   target_students t ON t.student_id = a.student_id
    WHERE  a.progress_pct IS NOT NULL AND a.occurred_at < CAST(:as_of AS timestamptz)
    GROUP  BY a.student_id, a.content_key, COALESCE(a.lesson_code, a.lesson_title, '')
),
student_progress AS (
    SELECT student_id, AVG(best_pct) AS avg_pct FROM item_best GROUP BY student_id
)
SELECT t.grade, t.class_no,
       COUNT(*)                                                    AS students,
       COUNT(wa.student_id)                                        AS active_7d,
       ROUND(100.0 * COUNT(wa.student_id) / NULLIF(COUNT(*), 0), 1) AS participation_pct,
       ROUND(AVG(COALESCE(sp.avg_pct, 0)), 1)                      AS avg_progress_pct
FROM   target_students t
LEFT   JOIN week_active      wa ON wa.student_id = t.student_id
LEFT   JOIN student_progress sp ON sp.student_id = t.student_id
GROUP  BY t.grade, t.class_no
ORDER  BY t.grade, t.class_no;
