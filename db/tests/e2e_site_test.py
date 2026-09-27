"""사이트 통합 시험: 교사 명단 업로드 → 학생 로그인·게임·실험 기록 → 오프라인 대기열 → 교사 모니터링."""
import json, time, urllib.request, urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright
API, SITE = "http://127.0.0.1:8870", "http://127.0.0.1:8871/"
SAMPLES = Path(__file__).resolve().parent.parent / "tools" / "samples"
def sql(q):
    r = urllib.request.Request(API + "/test/sql", data=json.dumps({"sql": q}).encode(), headers={"apikey": "anon-test", "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(r).read())
U = lambda f: SITE + urllib.parse.quote(f)
ok = lambda c, m: print(("  ✅ " if c else "  ❌ ") + m)
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    # ── A. 교사: 명단 올리기
    print("■ A. 교사 명단 올리기")
    tc = b.new_context(viewport={"width": 1280, "height": 900}); pg = tc.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)[:90]))
    pg.goto(U("교사_명단올리기.html")); pg.fill("#em", "teacher@school.kr"); pg.fill("#pw", "wrong"); pg.click("#lf button"); pg.wait_for_timeout(500)
    ok("Invalid" in pg.locator("#le").inner_text(), "틀린 비밀번호 거절: " + pg.locator("#le").inner_text())
    pg.fill("#pw", "pw1234"); pg.click("#lf button"); pg.wait_for_selector("#fi", state="attached")
    pg.set_input_files("#fi", str(SAMPLES / "2024_원덕중_명단.xlsx")); pg.wait_for_selector("#up")
    ok(pg.locator(".sum").inner_text().replace("\n", " ").startswith("전체 35행"), "미리보기: " + pg.locator(".sum").inner_text().replace("\n", " · "))
    pg.click("#up"); pg.wait_for_selector("#res .res"); ok("새로 추가 32명" in pg.locator("#res").inner_text(), "업로드: " + pg.locator("#res").inner_text().replace("\n", " "))
    pg.set_input_files("#fi", str(SAMPLES / "2024_원덕중_명단.xlsx")); pg.wait_for_selector("#up"); pg.click("#up"); pg.wait_for_selector("#res .res")
    ok("이미 올린 파일" in pg.locator("#res").inner_text(), "같은 파일 다시 → " + pg.locator("#res").inner_text()[:40])
    pg.fill("#dy", "2024"); pg.set_input_files("#fi", str(SAMPLES / "2024_3학년1반.txt")); pg.wait_for_selector("#up"); pg.click("#up"); pg.wait_for_selector("#res .res")
    ok("새로 추가 6명" in pg.locator("#res").inner_text(), "CP949 텍스트(연도·학교 열 없음): " + pg.locator("#res").inner_text().replace("\n", " "))
    pg.set_input_files("#fi", str(SAMPLES / "명단.hwp")); pg.wait_for_timeout(300); ok("지원하지 않는 형식" in pg.locator("#pv").inner_text(), "hwp → " + pg.locator("#pv").inner_text())
    name = sql("select name from students where grade=1 and class_no=1 and student_no=2")[0][0]
    # ── B. 학생: 로그인 + 게임 결과 자동 기록
    print("■ B. 학생 로그인 + 게임 기록 (개념 수비대)")
    sc = b.new_context(viewport={"width": 1280, "height": 900}); sp = sc.new_page(); sp.on("pageerror", lambda e: errs.append(str(e)[:90])); sp.on("dialog", lambda d: d.dismiss())
    sp.goto(U("개념수비대.html")); sp.wait_for_selector(".kjs-db-chip"); ok(sp.locator(".kjs-db-chip").inner_text() == "🙋 로그인", "머리글에 🙋 로그인 버튼")
    sp.click(".kjs-db-chip"); sp.select_option("#kdbG", "1"); sp.fill("#kdbC", "1"); sp.fill("#kdbN", "2"); sp.fill("#kdbName", "엉터리"); sp.click(".kjs-db-box .go"); sp.wait_for_timeout(400)
    ok("찾을 수 없어요" in sp.locator("#kdbErr").inner_text(), "이름 틀리면: " + sp.locator("#kdbErr").inner_text())
    sp.fill("#kdbName", name); sp.click(".kjs-db-box .go"); sp.wait_for_timeout(500)
    ok(name in sp.locator(".kjs-db-chip").inner_text(), "등록 후 칩: " + sp.locator(".kjs-db-chip").inner_text())
    sp.locator(".km-card.lesson").nth(3).click(); sp.wait_for_timeout(300); sp.click("#startBtn"); sp.wait_for_timeout(600)
    for _ in range(2):
        sp.evaluate("(()=>{const w=G.enemies.find(e=>e.alive&&e!==G.target); if(w) fireAt(w);})()"); sp.wait_for_timeout(1300)
    sp.evaluate("fireAt(G.target)"); sp.wait_for_timeout(300)
    sp.evaluate("(()=>{G.lives=1; breach(G.enemies.filter(e=>e.alive)[0]);})()"); sp.wait_for_timeout(600)
    if sp.locator(".kjs-modal-ov").count(): sp.click("#kjsNameSkip")
    sp.wait_for_timeout(2500)
    row = sql("select content_key, lesson_title, lesson_code, score, accuracy_pct, progress_pct, duration_sec, detail from learning_activities a join students s using(student_id) where s.name=%s order by activity_id desc limit 1".replace("%s", "'" + name + "'"))
    ok(bool(row) and row[0][0] == "invaders" and row[0][2] and row[0][7].get("wrong"), f"DB 기록 1건(결과 두 부품 합쳐짐): {row[0][:7] if row else '없음'} 틀린개념 {row[0][7].get('wrong') if row else ''}")
    ok(sql(f"select count(*) from learning_activities a join students s using(student_id) where s.name='{name}'")[0][0] == 1, "점수 부품·오답 부품이 한 건으로 합쳐짐(중복 없음)")
    # ── C. 가상실험 사용 시간
    print("■ C. 가상실험 사용 시간 기록")
    sp.clock.install(); sp.goto(U("마찰전기.html")); sp.wait_for_timeout(400); sp.clock.fast_forward(45000)
    sp.goto(U("옴의_법칙.html"))
    for _ in range(12):
        sp.wait_for_timeout(500)
        r = sql(f"select activity_type, content_key, duration_sec, progress_pct from learning_activities a join students s using(student_id) where s.name='{name}' and activity_type='simulation'")
        if r: break
    q_left = sp.evaluate("KJSDB.queue().length")
    ok(bool(r) and r[0][1] == "마찰전기" and 40 <= r[0][2] <= 50, f"실험 기록: {r} (남은 대기 {q_left})")
    # ── D. 오프라인 대기열
    print("■ D. 인터넷 끊김 → 대기열 → 재연결 시 전송")
    sc.set_offline(True); sp.evaluate("KJSDB.log({activity_type:'quiz', content_key:'goldenbell', score:80, progress_pct:100})"); sp.wait_for_timeout(300)
    ok(sp.evaluate("KJSDB.queue().length") == 1 and "1" in sp.locator(".kjs-db-chip .q").inner_text(), "오프라인: 대기 1건 표시")
    sc.set_offline(False); sp.evaluate("window.dispatchEvent(new Event('online'))"); sp.wait_for_timeout(1200)
    ok(sp.evaluate("KJSDB.queue().length") == 0 and sql(f"select count(*) from learning_activities a join students s using(student_id) where s.name='{name}' and content_key='goldenbell'")[0][0] == 1, "재연결 후 전송·대기열 비움")
    # ── E. QR 접속 안내
    print("■ E. QR 접속 학생 등록 안내")
    q2 = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True).new_page(); q2.goto(U("개념격추.html") + "?qr=1"); q2.wait_for_timeout(1200)
    ok(q2.locator(".kjs-db-ov").count() == 1, "QR로 들어오면 등록 창 1회 자동 표시(나중에 가능)")
    q2.click(".kjs-db-box .later"); q2.reload(); q2.wait_for_timeout(1200); ok(q2.locator(".kjs-db-ov").count() == 0, "같은 접속 중에는 다시 안 뜸")
    # ── F. 교사 모니터링
    print("■ F. 교사 학습 모니터링")
    mp = tc.new_page(); mp.on("pageerror", lambda e: errs.append(str(e)[:90])); mp.goto(U("교사_학습모니터링.html"))
    ok(mp.locator("#lf").count() == 1, "새 탭에서는 다시 로그인(교사 로그인은 탭별 보관)")
    mp.fill("#em", "teacher@school.kr"); mp.fill("#pw", "pw1234"); mp.click("#lf button"); mp.wait_for_selector("#tbl table", timeout=8000)
    mp.select_option("#yr", "2024"); mp.wait_for_timeout(800)
    rows = mp.locator("tr.row").count(); ok(rows == 38, f"학생 {rows}명 표시(2024 원덕중)")
    me = mp.locator("tr.row", has_text=name); txt = me.inner_text().replace("\t", " ")
    acts = int(txt.split()[5]); ok(acts == 3, f"로그인 학생 활동 {acts}건(게임·실험·퀴즈, 기기 시계가 빨라도 포함): " + txt[:70])
    card = mp.locator(".cls").first.inner_text().replace("\n", " "); ok("많이 틀린 개념" in card, "1학년 1반 카드: " + card[:120])
    mp.locator(".chip", has_text="미참여").click(); mp.wait_for_timeout(200); ok(mp.locator("tr.row").count() == 37, f"미참여 필터 {mp.locator('tr.row').count()}명")
    mp.locator(".chip").first.click(); me.click(); mp.wait_for_timeout(200); ok(mp.locator("tr.det").count() == 1, "학생 행 누르면 최근 활동 펼침: " + mp.locator("tr.det").inner_text().replace("\n", " | ")[:120])
    with mp.expect_download() as dl: mp.click("#csv")
    ok(dl.value.suggested_filename.startswith("학습모니터링_2024_원덕중학교"), "CSV 저장: " + dl.value.suggested_filename)
        # ── G. 서랍: 학생 칩·교사 메뉴
    print("■ G. 서랍 연결")
    hp = sc.new_page(); hp.goto(U("시작하기_수업게임서랍.html")); hp.wait_for_timeout(600)
    ok(hp.locator(".dh-r .kjs-db-chip").count() == 1, "수업게임 서랍 머리글에 학생 칩: " + hp.locator(".kjs-db-chip").inner_text())
    hp.click("#dhTools"); ok(hp.locator("#dhMenu a", has_text="학습 모니터링").count() == 1, "🧰 도구 메뉴에 학습 모니터링·명단 올리기")
    print("■ 브라우저 오류:", errs or "없음")
    b.close()
