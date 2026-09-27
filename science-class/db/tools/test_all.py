"""전체 시나리오 검증 (실제 PostgreSQL에서).  사용: DATABASE_URL=... python test_all.py"""
import os, random, uuid, json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import pandas as pd, sqlalchemy as sa
import roster_importer as ri
from activity_logger import record_activities
from monitor import weekly_report
from db import get_engine, T, ensure_schema

S = Path(__file__).with_name("samples")
if os.environ.get("ALLOW_DROP") != "1":
    raise SystemExit("⚠ 이 시험은 테이블을 모두 지우고 시작합니다. 시험용 DB에서만 ALLOW_DROP=1 을 붙여 실행하세요.")
e = get_engine()
with e.begin() as c:
    for t in ["learning_activities", "students", "schools", "academic_years", "import_batches"]:
        c.exec_driver_sql(f"DROP TABLE IF EXISTS {t} CASCADE")
for k in list(vars(T)): delattr(T, k)

ok = lambda cond, msg: print(("  ✅ " if cond else "  ❌ ") + msg) or cond
print("■ 1. 명단 업로드")
r = ri.import_roster(S / "2024_원덕중_명단.xlsx")
ok((r.status, r.inserted, r.skipped) == ("partial", 32, 3), f"엑셀: {r.summary()} | 사유 {[x['reason'] for x in r.errors]}")
try: ri.import_roster(S / "2024_원덕중_명단.xlsx"); ok(False, "중복 파일 차단")
except ri.DuplicateFileError: ok(True, "같은 파일 재업로드 → DuplicateFileError")
try: ri.import_roster(S / "2024_3학년1반.txt"); ok(False, "필수 열")
except ri.RosterSchemaError as ex: ok(True, f"연도·학교 열 없음 → {ex}")
r = ri.import_roster(S / "2024_3학년1반.txt", year=2024, school="원덕중학교"); ok(r.inserted == 6, f"CP949 텍스트 + 기본값: {r.summary()}")
r = ri.import_roster(S / "2025_원덕중_명단.csv"); ok(r.inserted == 5, f"2025 CSV: {r.summary()}")
r = ri.import_roster(S / "2024_원덕중_명단_수정본.xlsx", deactivate_missing=True)
ok((r.updated, r.deactivated) == (31, 1), f"수정본(개명1·전학1): {r.summary()}")
for bad, exc in [("없는파일.xlsx", ri.RosterFileError), ("빈파일.txt", ri.RosterFileError), ("명단.hwp", ri.RosterFileError)]:
    try: ri.import_roster(S / bad); ok(False, bad)
    except exc as ex: ok(True, f"{bad} → {ex}")
with e.connect() as c:
    yrs = c.exec_driver_sql("select y.year, count(*) from academic_years y join schools s using(year_id) join students st using(school_id) group by 1 order by 1").all()
    ok(yrs == [(2024, 38), (2025, 5)], f"연도별 학생 수 {yrs} (2024: 32+6, 2025: 5 — 연도 섞이지 않음)")
    ok(c.exec_driver_sql("select name from students where student_code='202410101'").scalar() == "김개명", "개명 갱신 반영")
    ok(c.exec_driver_sql("select count(*) from students where grade=3 and is_active").scalar() == 6, "3학년1반은 수정본에 없어도 활성 유지(반 단위 비활성)")

print("■ 2. 학습 활동 기록")
random.seed(11)
with e.connect() as c:
    studs = c.exec_driver_sql("select st.student_id from students st join schools s using(school_id) join academic_years y using(year_id) where y.year=2024 and st.is_active order by 1").scalars().all()
AS_OF = datetime(2024, 5, 10, 18, 0, tzinfo=timezone(timedelta(hours=9)))
CONTENT = [("game", "shootdown", "개념 격추"), ("game", "invaders", "개념 수비대"), ("simulation", "옴의_법칙", "옴의 법칙"), ("worksheet", "ws_ohm", "옴의 법칙 활동지")]
recs = []
for sid in studs[:-5]:                                   # 마지막 5명은 미참여
    for _ in range(random.randint(1, 9)):
        t, key, _nm = random.choice(CONTENT)
        recs.append({"student_id": sid, "activity_type": t, "content_key": key, "unit_name": "전기와 자기",
                     "lesson_title": random.choice(["1차시 · 마찰 전기", "2차시 · 정전기 유도", "5차시 · 옴의 법칙"]),
                     "lesson_code": None, "score": random.randint(20, 100), "accuracy_pct": random.randint(30, 100),
                     "progress_pct": random.choice([25, 50, 75, 100]), "duration_sec": random.randint(60, 900),
                     "occurred_at": (AS_OF - timedelta(days=random.uniform(0, 13.9))).isoformat(),
                     "detail": {"wrong": ["자유 전자"]} if random.random() < .3 else {}, "client_event_id": str(uuid.uuid4())})
dup = dict(recs[0]); bad = [
    {"student_id": 999999, "activity_type": "game", "content_key": "x", "occurred_at": AS_OF.isoformat()},
    {"student_id": studs[0], "activity_type": "cooking", "content_key": "x", "occurred_at": AS_OF.isoformat()},
    {"student_id": studs[0], "activity_type": "game", "content_key": "x", "progress_pct": 150, "occurred_at": AS_OF.isoformat()},
    {"student_id": studs[0], "activity_type": "game", "content_key": "x", "occurred_at": "2024-05-01T10:00:00"},
    {"year": 2024, "school_name": "원덕중학교", "grade": 1, "class_no": 1, "student_no": 2, "activity_type": "quiz",
     "content_key": "goldenbell", "score": 80, "progress_pct": 100, "occurred_at": (AS_OF - timedelta(hours=3)).isoformat()}]
res = record_activities(recs + [dup] + bad)
ok(res["inserted"] == len(recs) + 1 and res["duplicates"] == 1 and len(res["rejected"]) == 4,
   f"기록 {res['inserted']}건, 중복 {res['duplicates']}건 무시, 거절 {[x['reason'] for x in res['rejected']]}")
res2 = record_activities(recs[:10]); ok(res2["inserted"] == 0 and res2["duplicates"] == 10, "같은 묶음 재전송 → 모두 중복 처리")

print("■ 3. 모니터링 쿼리 (결과를 파이썬 독립 계산과 대조)")
st, cl = weekly_report(2024, "원덕중학교", AS_OF)
with e.connect() as c:
    acts = pd.read_sql("select a.*, s.grade, s.class_no, s.student_no from learning_activities a join students s using(student_id)", c)
    roster = pd.read_sql("select st.student_id, grade, class_no, student_no, name from students st join schools sc using(school_id) join academic_years y using(year_id) where y.year=2024 and sc.school_name='원덕중학교' and is_active", c)
acts["occurred_at"] = pd.to_datetime(acts["occurred_at"], utc=True)
asof = pd.Timestamp(AS_OF).tz_convert("UTC")
wk = acts[(acts.occurred_at >= asof - pd.Timedelta(days=7)) & (acts.occurred_at < asof)]
past = acts[acts.occurred_at < asof].dropna(subset=["progress_pct"]).copy()
past["item"] = past["lesson_code"].fillna(past["lesson_title"]).fillna("")
best = past.groupby(["student_id", "content_key", "item"]).progress_pct.max().groupby("student_id").mean()
bad_rows = 0
for _, r in roster.iterrows():
    row = st[(st.grade == r.grade) & (st.class_no == r.class_no) & (st.student_no == r.student_no)].iloc[0]
    w = wk[wk.student_id == r.student_id]
    kst_days = w.occurred_at.dt.tz_convert("Asia/Seoul").dt.date.nunique()
    exp = dict(n=len(w), days=kst_days, mins=w.duration_sec.fillna(0).sum() / 60, sc=w.score.astype(float).mean() if len(w) else None,
               prog=float(best.get(r.student_id, 0)))
    got = dict(n=int(row.activities_7d), days=int(row.active_days_7d), mins=float(row.minutes_7d), sc=None if pd.isna(row.avg_score_7d) else float(row.avg_score_7d),
               prog=float(row.avg_progress_pct))
    if exp["sc"] is not None and got["sc"] is not None and abs(exp["sc"] - got["sc"]) <= 0.051: exp["sc"] = got["sc"]
    if abs(exp["mins"] - got["mins"]) <= 0.051: exp["mins"] = got["mins"]
    if abs(exp["prog"] - got["prog"]) <= 0.051: exp["prog"] = got["prog"]
    if exp != got: bad_rows += 1; print("     불일치", r["name"], exp, got)
ok(bad_rows == 0 and len(st) == len(roster), f"학생 {len(st)}명 전원 행 존재, 활동 수·활동일(한국 날짜)·학습시간·평균점수·평균 진도율 모두 일치")
ok((st.status == "미참여").sum() >= 5, f"미참여 표시 {int((st.status=='미참여').sum())}명 (활동 없는 학생 포함)")
first = st[st.activities_7d > 0].iloc[0]
ok(isinstance(first.recent_5, list) and len(first.recent_5) <= 5, f"최근 활동 JSON 예: {json.dumps(first.recent_5[0], ensure_ascii=False)}")
ok(len(cl) == 5, f"학급 요약 {len(cl)}개 반:\n" + cl.to_string(index=False))
print("\n■ 4. 실행 계획 (인덱스 사용 여부, 인덱스를 강제 비교)")
with e.connect() as c:
    c.exec_driver_sql("SET enable_seqscan = off")
    q = open(Path(__file__).resolve().parent.parent / "monitoring_queries.sql", encoding="utf-8").read().split("-- [Q2]")[0].split("-- [Q1]")[1].split("\n", 1)[1].rstrip().rstrip(";")
    plan = c.execute(sa.text("EXPLAIN " + q), {"year": 2024, "school_name": "원덕중학교", "as_of": AS_OF, "tz": "Asia/Seoul"}).scalars().all()
    ok(any("ix_act_student_time" in p for p in plan), "learning_activities 는 (student_id, occurred_at) 인덱스로 읽음")

print("\n■ 5. 명령줄 도구")
import subprocess, sys, db as _db
for _e in _db._engines.values(): _e.dispose()   # 시험용 DB는 연결 1개만 허용 → 먼저 반납
out = subprocess.run([sys.executable, "monitor.py", "--year", "2024", "--school", "원덕중학교", "--as-of", AS_OF.isoformat(), "--excel", "/tmp/주간보고.xlsx"],
                     capture_output=True, text=True, env=os.environ).stdout
print("\n".join(out.splitlines()[:16])); ok(Path("/tmp/주간보고.xlsx").exists(), "엑셀 보고서 저장")
out2 = subprocess.run([sys.executable, "monitor.py", "--year", "2030", "--school", "원덕중학교"], capture_output=True, text=True, env=os.environ).stdout
ok("학생이 없습니다" in out2, "없는 연도 조회 → " + out2.strip())
