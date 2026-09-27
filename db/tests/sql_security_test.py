"""Supabase API 계층 시험: 역할별 권한·함수 동작 (PostgreSQL 에서 SET ROLE 로 anon/authenticated 흉내)."""
import os, json, uuid, psycopg2
from pathlib import Path
B = Path(__file__).resolve().parent.parent
c = psycopg2.connect(os.environ["PG_DSN"]); c.autocommit = True; q = c.cursor()
for t in ["student_tokens","teacher_schools","teachers","learning_activities","students","schools","academic_years","import_batches"]:
    q.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
q.execute((B/"tests/supabase_stub.sql").read_text()); q.execute((B/"schema_postgresql.sql").read_text()); q.execute((B/"supabase_api.sql").read_text())
T1, T2 = str(uuid.uuid4()), str(uuid.uuid4())
q.execute("insert into teachers values (%s,'김과학',now()),(%s,'타학교',now())", (T1, T2))
q.execute("insert into teacher_schools values (%s,'원덕중학교'),(%s,'다른중학교')", (T1, T2))
ok = lambda cond, m: print(("  ✅ " if cond else "  ❌ ") + m)
def as_role(role, sub=None):
    q.execute("RESET ROLE"); q.execute("select set_config('request.jwt.claim.sub', %s, false)", (sub or "",)); q.execute(f"SET ROLE {role}")
def call(fn, **kw):
    args = ", ".join(f"{k} => %s" for k in kw); q.execute(f"select public.{fn}({args})", [json.dumps(v) if isinstance(v,(list,dict)) else v for v in kw.values()])
    return q.fetchone()[0]
def denied(sql):
    try: q.execute(sql); return False
    except psycopg2.Error as e: c.rollback() if not c.autocommit else None; return "permission denied" in str(e)

print("■ 권한(학생=anon)")
as_role("anon")
ok(denied("select * from students"), "anon: students 직접 조회 차단")
ok(denied("insert into learning_activities(student_id,activity_type,content_key) values (1,'game','x')"), "anon: 활동 직접 입력 차단")
ok(denied("select public.teacher_me()"), "anon: 교사 함수 실행 차단")
print("■ 교사: 명단 업로드")
as_role("authenticated", T1)
rows = [{"year":2026,"school_name":"원덕중학교","grade":2,"class_no":1,"student_no":n,"name":nm} for n,nm in [(1,"김민준"),(2,"이서연"),(3,"박도윤")]]
rows += [{"year":2026,"school_name":"원덕중학교","grade":2,"class_no":2,"student_no":1,"name":"최하은"},
         {"year":2026,"school_name":"다른중학교","grade":1,"class_no":1,"student_no":1,"name":"남의학생"},
         {"year":"이천이십육","school_name":"원덕중학교","grade":2,"class_no":1,"student_no":9,"name":"형식오류"},
         {"year":2026,"school_name":"원덕중학교","grade":2,"class_no":1,"student_no":2,"name":"이서연B"}]   # 파일 안 중복(뒤 행)
r = call("teacher_upsert_roster", p_file_name="2학년.xlsx", p_sha256="a"*64, p_rows=rows)
ok(r["ok"] and r["inserted"] == 4 and len(r["rejected"]) == 2, f"업로드: 추가 {r['inserted']}, 거절 {[x['reason'] for x in r['rejected']]}")
r2 = call("teacher_upsert_roster", p_file_name="2학년.xlsx", p_sha256="a"*64, p_rows=rows)
ok(not r2["ok"] and r2.get("duplicate"), "같은 파일 재업로드 차단: " + r2["error"][:40])
r3 = call("teacher_upsert_roster", p_file_name="2-1수정.xlsx", p_sha256="b"*64, p_deactivate_missing=True,
          p_rows=[{"year":2026,"school_name":"원덕중학교","grade":2,"class_no":1,"student_no":n,"name":nm} for n,nm in [(1,"김민준"),(2,"이서연")]])
ok(r3["updated"] == 2 and r3["deactivated"] == 1, f"2학년1반 수정본: 갱신 {r3['updated']}, 비활성 {r3['deactivated']} (2반은 유지)")
as_role("authenticated", T2)
r4 = call("teacher_monitor", p_year=2026, p_school="원덕중학교")
ok(not r4["ok"], "다른 학교 교사는 원덕중 조회 불가: " + r4["error"])
print("■ 학생: 등록·기록")
as_role("anon")
ok(any(x["school_name"]=="원덕중학교" for x in call("school_list")), "학교 목록 공개(이름·연도만)")
bad = call("student_sign_in", p_year=2026, p_school="원덕중학교", p_grade=2, p_class=1, p_no=1, p_name="김엉뚱")
ok(not bad["ok"], "이름 틀리면 등록 거절")
s1 = call("student_sign_in", p_year=2026, p_school="원덕중학교", p_grade=2, p_class=1, p_no=1, p_name="김 민준")
ok(s1["ok"], "띄어쓰기 달라도 등록 성공 → 토큰 발급")
gone = call("student_sign_in", p_year=2026, p_school="원덕중학교", p_grade=2, p_class=1, p_no=3, p_name="박도윤")
ok(not gone["ok"], "비활성(전학) 학생은 등록 불가")
ev = lambda **k: dict({"activity_type":"game","content_key":"shootdown","client_event_id":str(uuid.uuid4())}, **k)
evs = [ev(score=80, accuracy_pct=90, progress_pct=100, duration_sec=300, lesson_title="5차시 · 옴의 법칙", detail={"wrong":["자유 전자","저항"]}),
       ev(score=60, accuracy_pct=70, progress_pct=50, detail={"wrong":["자유 전자"]}),
       ev(activity_type="cooking"), ev(progress_pct=150), ev(occurred_at="2099-01-01T00:00:00+09:00")]
evs.append(dict(evs[0]))
r5 = call("log_activities", p_token=s1["token"], p_events=evs)
ok(r5["inserted"] == 2 and r5["duplicates"] == 1 and len(r5["rejected"]) == 3, f"기록 {r5['inserted']}, 중복 {r5['duplicates']}, 거절 {[x['reason'][:22] for x in r5['rejected']]}")
ok(not call("log_activities", p_token=str(uuid.uuid4()), p_events=[ev()])["ok"], "가짜 토큰 거절")
print("■ 교사: 모니터링")
as_role("authenticated", T1)
m = call("teacher_monitor", p_year=2026, p_school="원덕중학교")
st = {x["name"]: x for x in m["students"]}
ok(len(m["students"]) == 3 and st["김민준"]["activities"] == 2 and st["김민준"]["avg_progress"] == 75 and st["이서연"]["status"] == "미참여",
   f"학생 {len(m['students'])}명, 김민준 활동 {st['김민준']['activities']}·진도 {st['김민준']['avg_progress']}, 이서연 {st['이서연']['status']}")
c21 = [x for x in m["classes"] if x["class_no"] == 1][0]
ok(c21["wrong_top"][0] == {"concept":"자유 전자","count":2,"students":1}, f"학급 오답 TOP: {c21['wrong_top']}")
me = call("teacher_me"); ok(me["is_teacher"] and me["schools"] == ["원덕중학교"], f"teacher_me: {me}")
q.execute("RESET ROLE")
