/* 과학수업 서랍 · 학습 기록 DB 연결 (Supabase REST)
   ─ 설정(kjs-db-config.js)에 url·anonKey 가 없으면 아무 것도 하지 않는다(오프라인 교실 그대로).
   ─ 학생: 🙋 로그인(학년·반·번호·이름) → 기기 토큰 저장 → 게임 결과·실험/활동지 사용 시간을 자동 기록
          인터넷이 끊겨도 기기에 모아 두었다가(최대 500건) 연결되면 보낸다.
   ─ 교사: KJSDB.teacher.login / rpc  (교사 페이지에서 사용)
   script 태그 속성: data-type="game|simulation|worksheet|etc"  data-role="teacher"(학생 UI 숨김)
*/
(function(){
  if (window.KJSDB) return;
  var CFG = window.KJS_DB_CONFIG || {};
  var SELF = document.currentScript || {};
  var PAGE_TYPE = (SELF.getAttribute && SELF.getAttribute("data-type")) || "";
  var ROLE = (SELF.getAttribute && SELF.getAttribute("data-role")) || "student";
  var enabled = !!(CFG.url && CFG.anonKey);
  var K_STU = "kjs-db-student", K_Q = "kjs-db-queue", K_T = "kjs-db-teacher";
  var FILE = decodeURIComponent(location.pathname.split("/").pop() || "index.html");
  var CONTENT = FILE.replace(/\.html$/, "");

  function get(k, store){ try { return JSON.parse((store || localStorage).getItem(k) || "null"); } catch(e){ return null; } }
  function set(k, v, store){ try { (store || localStorage).setItem(k, JSON.stringify(v)); } catch(e){} }
  function del(k, store){ try { (store || localStorage).removeItem(k); } catch(e){} }
  function uuid(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach(function(_, i){ b[i] = Math.random() * 256 | 0; });
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function(x){ return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20);
  }
  var esc = function(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;"); };

  /* ───────── REST 호출 ───────── */
  function rpc(fn, args, bearer, keepalive){
    if (!enabled) return Promise.reject(new Error("DB 설정이 비어 있어요(kjs-db-config.js)."));
    return fetch(CFG.url.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST", keepalive: !!keepalive,
      headers: { "apikey": CFG.anonKey, "Authorization": "Bearer " + (bearer || CFG.anonKey), "Content-Type": "application/json" },
      body: JSON.stringify(args || {})
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){
        if (!r.ok) { var e = new Error(j.message || j.error || ("HTTP " + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  /* ───────── 학생 등록 ───────── */
  function student(){ return get(K_STU); }
  function signIn(p){
    return rpc("student_sign_in", { p_year: +p.year, p_school: p.school, p_grade: +p.grade, p_class: +p.class_no,
                                    p_no: +p.student_no, p_name: p.name }).then(function(r){
      if (!r.ok) throw new Error(r.error || "등록하지 못했어요.");
      set(K_STU, { token: r.token, info: r.student, at: Date.now() }); paintChip(); flush(); return r.student;
    });
  }
  function signOut(){ del(K_STU); paintChip(); }

  /* ───────── 기록 대기열 ───────── */
  function queue(){ return get(K_Q) || []; }
  function log(ev){
    var s = student(); if (!enabled || !s) return false;
    var q = queue();
    q.push(Object.assign({ client_event_id: uuid(), occurred_at: new Date().toISOString(), _t: s.token }, ev));
    if (q.length > 500) q = q.slice(-500);
    set(K_Q, q); paintChip(); flush(); return true;
  }
  var flushing = false;
  function flush(keepalive){
    var s = student(); if (!enabled || !s || flushing || (navigator.onLine === false)) return Promise.resolve();
    var q = queue(); var mine = q.filter(function(e){ return e._t === s.token; }).slice(0, 100);
    var others = q.filter(function(e){ return e._t !== s.token; });
    if (!mine.length) { if (others.length !== q.length) set(K_Q, q.filter(function(e){ return e._t === s.token; })); return Promise.resolve(); }
    flushing = true;
    var body = mine.map(function(e){ var c = Object.assign({}, e); delete c._t; return c; });
    return rpc("log_activities", { p_token: s.token, p_events: body }, null, keepalive).then(function(r){
      var sent = {}; mine.forEach(function(e){ sent[e.client_event_id] = 1; });
      if (!r.ok && r.error === "invalid_token") { signOut(); set(K_Q, []); return; }   // 폐기된 기기: 다시 등록하도록
      set(K_Q, queue().filter(function(e){ return !sent[e.client_event_id]; }));      // 저장·중복·거절 모두 처리 끝
      paintChip();
      if (queue().some(function(e){ return e._t === s.token; })) { flushing = false; return flush(keepalive); }
    }).catch(function(){ /* 오프라인·서버 오류: 대기열 유지, 다음 기회에 */ })
      .then(function(){ flushing = false; });
  }
  window.addEventListener("online", function(){ flush(); });

  /* ───────── 자동 기록: 게임 결과 ───────── */
  var pageStart = Date.now(), lessonStart = Date.now(), pending = null, pendingTimer = null, resultLogged = false;
  function currentLesson(){ return (window.KJSMenu && window.KJSMenu._current) || window.__kjsCurrent || null; }
  function mergeResult(patch){
    if (!pending) pending = { activity_type: "game", content_key: CONTENT, progress_pct: 100 };
    Object.keys(patch).forEach(function(k){ if (patch[k] !== undefined && patch[k] !== null && patch[k] !== "") pending[k] = patch[k]; });
    clearTimeout(pendingTimer); pendingTimer = setTimeout(commitResult, 1500);
  }
  function commitResult(){
    if (!pending) return;
    var c = currentLesson();
    if (c) { pending.lesson_code = pending.lesson_code || c.q; pending.lesson_title = pending.lesson_title || c.title; pending.unit_name = pending.unit_name || c.unit; }
    pending.duration_sec = Math.round((Date.now() - lessonStart) / 1000);
    if (pending.accuracy_pct != null) pending.accuracy_pct = Math.max(0, Math.min(100, Math.round(pending.accuracy_pct * 10) / 10));
    log(pending); pending = null; resultLogged = true; lessonStart = Date.now();
  }
  function hookResults(){
    var S = window.KJSScore, I = window.KJSInsight, done = false;
    if (S && !S._dbHook && S.finishIndividual) {
      S._dbHook = 1; var fi = S.finishIndividual;
      S.finishIndividual = function(o){
        try { mergeResult({ content_key: o.game, unit_name: o.unit, lesson_title: o.lesson, score: o.score,
                            accuracy_pct: typeof o.accuracy === "number" ? o.accuracy : undefined }); } catch(e){}
        return fi.apply(this, arguments);
      };
      done = true;
    }
    if (I && !I._dbHook && I.report) {
      I._dbHook = 1; var rp = I.report, bg = I.begin;
      I.begin = function(){ lessonStart = Date.now(); return bg.apply(this, arguments); };
      I.report = function(){
        try {
          var s = I._session && I._session();
          if (s) {
            var terms = Object.keys(s.terms || {}).map(function(k){ return s.terms[k]; });
            var hit = 0, miss = 0; terms.forEach(function(t){ hit += t.hit; miss += t.miss; });
            var wrong = terms.filter(function(t){ return t.miss > 0 || t.hint > 0; })
                             .sort(function(a, b){ return (b.miss * 2 + b.hint) - (a.miss * 2 + a.hint); })
                             .slice(0, 10).map(function(t){ return t.term; });
            mergeResult({ content_key: s.game || CONTENT, unit_name: s.unit, lesson_title: s.lesson,
                          accuracy_pct: (hit + miss) ? hit / (hit + miss) * 100 : undefined,
                          detail: { wrong: wrong, hits: hit, misses: miss } });
          }
        } catch(e){}
        return rp.apply(this, arguments);
      };
      done = true;
    }
    return done;
  }

  /* ───────── 자동 기록: 실험·활동지·그 밖의 화면 사용 시간 ───────── */
  var activeMs = 0, visibleSince = document.hidden ? 0 : Date.now(), loggedMs = 0;
  function tickActive(){ if (visibleSince) { activeMs += Date.now() - visibleSince; visibleSince = document.hidden ? 0 : Date.now(); } }
  function pageType(){
    if (PAGE_TYPE) return PAGE_TYPE;
    if (/활동지/.test(FILE)) return "worksheet";
    if (window.KJSMenu || window.KJSScore || window.KJSInsight) return "game";
    return "simulation";
  }
  function logSession(){
    tickActive();
    var delta = activeMs - loggedMs;
    if (PAGE_TYPE === "none" || !student() || resultLogged || delta < 30000) return;
    loggedMs = activeMs;
    var title = (document.title || CONTENT).split(/\s*[·|—]\s*/)[0].replace(/^\[교사용\]\s*/, "");
    log({ activity_type: pageType(), content_key: CONTENT, lesson_title: title.slice(0, 150),
          duration_sec: Math.round(delta / 1000), progress_pct: Math.min(100, Math.round(activeMs / 3000)) });   // 5분 = 100%
  }
  document.addEventListener("visibilitychange", function(){
    if (document.hidden) { logSession(); flush(true); } else { visibleSince = Date.now(); }
  });
  window.addEventListener("pagehide", function(){ commitResult(); logSession(); flush(true); });

  /* ───────── 학생 화면: 🙋 로그인 칩과 등록 창 ───────── */
  var chip = null;
  function injectStyle(){
    if (document.getElementById("kjs-db-style")) return;
    var st = document.createElement("style"); st.id = "kjs-db-style";
    st.textContent = [
      ".kjs-db-chip{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 11px;border-radius:999px;border:1.5px solid #86efac;background:#f0fdf4;color:#166534;font:800 13px/1 -apple-system,'Pretendard','Malgun Gothic',sans-serif;cursor:pointer;white-space:nowrap;flex:none}",
      ".kjs-db-chip.out{border-color:#fcd34d;background:#fffbeb;color:#92400e}",
      ".kjs-db-chip .q{font-size:11px;background:#fde68a;color:#78350f;border-radius:999px;padding:2px 6px}",
      ".kjs-db-chip.float{position:fixed;left:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:99980;box-shadow:0 4px 14px rgba(0,0,0,.18)}",
      ".kjs-db-ov{position:fixed;inset:0;z-index:100050;background:rgba(15,23,42,.6);display:grid;place-items:center;padding:14px;font-family:-apple-system,'Pretendard','Malgun Gothic',sans-serif}",
      ".kjs-db-box{background:#fff;color:#0f172a;border-radius:18px;width:min(400px,100%);padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.3)}",
      ".kjs-db-box h3{margin:0 0 4px;font-size:19px}.kjs-db-box p{margin:0 0 14px;color:#64748b;font-size:13px;line-height:1.5}",
      ".kjs-db-row{display:flex;gap:8px;margin-bottom:10px}.kjs-db-row label{flex:1;display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:800;color:#475569}",
      ".kjs-db-box input,.kjs-db-box select{height:42px;border:1.5px solid #cbd5e1;border-radius:10px;padding:0 10px;font-size:16px;width:100%;box-sizing:border-box;background:#fff}",
      ".kjs-db-box .go{width:100%;height:46px;border:0;border-radius:12px;background:#16a34a;color:#fff;font-size:16px;font-weight:900;cursor:pointer;margin-top:4px}",
      ".kjs-db-box .later{width:100%;height:38px;border:0;background:none;color:#64748b;font-weight:700;cursor:pointer;margin-top:6px}",
      ".kjs-db-box .err{color:#dc2626;font-weight:700;font-size:13px;min-height:18px;margin:6px 0 0}",
      ".kjs-db-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100060;background:#166534;color:#fff;font:800 14px -apple-system,'Malgun Gothic',sans-serif;padding:10px 16px;border-radius:999px;box-shadow:0 8px 20px rgba(0,0,0,.2)}",
      "@media print{.kjs-db-chip,.kjs-db-ov{display:none!important}}"
    ].join("\n");
    document.head.appendChild(st);
  }
  function toast(msg){ var t = document.createElement("div"); t.className = "kjs-db-toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(function(){ t.remove(); }, 2600); }
  function paintChip(){
    if (!chip) return;
    var s = student(), n = queue().length;
    if (s) {
      var i = s.info;
      chip.className = chip.className.replace(/\bout\b/, "").trim();
      chip.innerHTML = "🙋 " + i.grade + "-" + i.class_no + "-" + String(i.student_no).padStart(2, "0") + " " + esc(i.name) + (n ? " <span class='q' title='보내기 대기'>" + n + "</span>" : "");
      chip.title = "학습 기록 중 · 눌러서 로그아웃";
    } else {
      if (!/\bout\b/.test(chip.className)) chip.className += " out";
      chip.textContent = "🙋 로그인"; chip.title = "학년·반·번호·이름으로 등록하면 학습 기록이 선생님께 전달돼요";
    }
  }
  function openSignIn(auto){
    if (document.querySelector(".kjs-db-ov")) return;
    var ov = document.createElement("div"); ov.className = "kjs-db-ov";
    ov.innerHTML = '<form class="kjs-db-box" autocomplete="off">' +
      '<h3>🙋 학생 등록</h3><p>학년·반·번호와 이름을 넣으면, 게임 결과와 실험 기록이 선생님께 전달돼요.</p>' +
      '<div class="kjs-db-row" id="kdbSchoolRow"><label>학교<select id="kdbSchool"></select></label></div>' +
      '<div class="kjs-db-row"><label>학년<select id="kdbG"><option>1</option><option>2</option><option>3</option></select></label>' +
      '<label>반<input id="kdbC" type="number" inputmode="numeric" min="1" max="30" required></label>' +
      '<label>번호<input id="kdbN" type="number" inputmode="numeric" min="1" max="60" required></label></div>' +
      '<div class="kjs-db-row"><label>이름<input id="kdbName" type="text" maxlength="20" required></label></div>' +
      '<button class="go" type="submit">등록하고 시작</button>' +
      '<button class="later" type="button">' + (auto ? "나중에 할게요" : "닫기") + '</button><p class="err" id="kdbErr"></p></form>';
    document.body.appendChild(ov);
    var sel = ov.querySelector("#kdbSchool");
    function fill(list){
      sel.innerHTML = list.map(function(x){ return '<option value="' + esc(x.year + "|" + x.school_name) + '">' + esc(x.school_name + " (" + x.year + ")") + '</option>'; }).join("");
      var want = (CFG.year || "") + "|" + (CFG.school || ""); if ([].some.call(sel.options, function(o){ return o.value === want; })) sel.value = want;
      ov.querySelector("#kdbSchoolRow").style.display = list.length > 1 ? "" : "none";
    }
    fill([{ year: CFG.year || new Date().getFullYear(), school_name: CFG.school || "" }]);
    rpc("school_list", {}).then(function(l){ if (Array.isArray(l) && l.length) fill(l); }).catch(function(){});
    ov.querySelector(".later").onclick = function(){ ov.remove(); };
    ov.querySelector("form").onsubmit = function(e){
      e.preventDefault();
      var ys = sel.value.split("|"), btn = ov.querySelector(".go"), err = ov.querySelector("#kdbErr");
      btn.disabled = true; btn.textContent = "확인 중…"; err.textContent = "";
      signIn({ year: ys[0], school: ys.slice(1).join("|"), grade: ov.querySelector("#kdbG").value, class_no: ov.querySelector("#kdbC").value,
               student_no: ov.querySelector("#kdbN").value, name: ov.querySelector("#kdbName").value.trim() })
        .then(function(info){ ov.remove(); toast("✅ " + info.name + " 학생, 등록됐어요!"); })
        .catch(function(ex){ err.textContent = navigator.onLine === false ? "인터넷에 연결되어 있지 않아요." : ex.message; btn.disabled = false; btn.textContent = "등록하고 시작"; });
    };
    setTimeout(function(){ var c = ov.querySelector("#kdbC"); c && c.focus(); }, 50);
  }
  function mountChip(){
    if (chip || ROLE === "teacher") return;
    injectStyle();
    chip = document.createElement("button"); chip.type = "button"; chip.className = "kjs-db-chip";
    chip.onclick = function(){
      var s = student();
      if (!s) return openSignIn(false);
      if (confirm(s.info.name + " 학생으로 기록 중이에요.\n로그아웃할까요? (다른 학생이 이 기기를 쓸 때)")) { flush(); signOut(); toast("로그아웃했어요."); }
    };
    var host = document.querySelector(".dh-r") || document.querySelector(".unified-nav-actions") || document.querySelector(".m-right");
    if (host) host.insertBefore(chip, host.firstChild); else { chip.className += " float"; document.body.appendChild(chip); }
    paintChip();
    // QR로 들어온 학생이 아직 등록 전이면 한 번만 안내
    var qr = document.documentElement.classList.contains("qr-focus-mode");
    if (qr && !student()) { try { if (!sessionStorage.getItem("kjs-db-nudge")) { sessionStorage.setItem("kjs-db-nudge", "1"); setTimeout(function(){ openSignIn(true); }, 600); } } catch(e){} }
  }

  /* ───────── 교사 로그인 (Supabase Auth) ───────── */
  function authFetch(grant, body){
    return fetch(CFG.url.replace(/\/$/, "") + "/auth/v1/token?grant_type=" + grant, {
      method: "POST", headers: { "apikey": CFG.anonKey, "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(function(r){ return r.json().then(function(j){
      if (!r.ok) throw new Error(j.error_description || j.msg || j.message || "로그인하지 못했어요.");
      var t = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000,
                email: (j.user && j.user.email) || body.email || "" };
      set(K_T, t, sessionStorage); return t;
    }); });
  }
  var teacher = {
    session: function(){ return get(K_T, sessionStorage); },
    login: function(email, password){ return authFetch("password", { email: email, password: password }); },
    logout: function(){ del(K_T, sessionStorage); },
    token: function(){
      var t = teacher.session(); if (!t) return Promise.reject(new Error("로그인이 필요해요."));
      if (Date.now() < t.expires_at - 60000) return Promise.resolve(t.access_token);
      return authFetch("refresh_token", { refresh_token: t.refresh_token }).then(function(n){ return n.access_token; })
        .catch(function(e){ teacher.logout(); throw new Error("로그인이 만료됐어요. 다시 로그인해 주세요."); });
    },
    rpc: function(fn, args){ return teacher.token().then(function(tok){ return rpc(fn, args, tok); }); }
  };

  window.KJSDB = { enabled: enabled, config: CFG, rpc: rpc, student: student, signIn: signIn, signOut: signOut,
                   openSignIn: openSignIn, log: log, flush: flush, queue: queue, teacher: teacher, _commit: commitResult };
  if (!enabled) return;
  function init(){
    mountChip();
    if (!hookResults()) { var n = 0, t = setInterval(function(){ if (hookResults() || ++n > 20) clearInterval(t); }, 250); }
    flush();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
