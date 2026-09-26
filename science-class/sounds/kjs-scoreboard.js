/* 수업 게임 서랍 · 공용 점수 기록/순위표 모듈
   - 개인전: KJSScore.finishIndividual({game, unit, lesson, score, accuracy, minAcc, extra})
   - 모둠전: KJSScore.finishTeams({game, unit, lesson, teams:[{name,score}], extra})
   - 브라우저(기기)별로 localStorage에 누적 저장. 서버가 없으므로 "이 기기·이 브라우저" 범위의 기록입니다.
*/
(function(){
  const LS_DB = "kjs-scoreboard-v1";
  const LS_NAME = "kjs-player-name";
  const CAP = 4000;

  function loadDB(){
    try { const d = JSON.parse(localStorage.getItem(LS_DB) || "null"); if (d && d.individual && d.team) return d; }
    catch(e){}
    return { individual: [], team: [] };
  }
  function saveDB(db){
    try {
      if (db.individual.length > CAP) db.individual = db.individual.slice(-CAP);
      if (db.team.length > CAP) db.team = db.team.slice(-CAP);
      localStorage.setItem(LS_DB, JSON.stringify(db));
    } catch(e){}
  }
  function today(){
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function getName(){ try { return localStorage.getItem(LS_NAME) || ""; } catch(e){ return ""; } }
  function setName(n){ try { localStorage.setItem(LS_NAME, n.slice(0,20)); } catch(e){} }
  const esc = s => String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;");

  function topRows(kind, { game, unit, lesson, scope }){
    const db = loadDB();
    let rows = db[kind].filter(r => r.game === game);
    if (scope === "lesson") rows = rows.filter(r => r.unit === unit && r.lesson === lesson);
    else if (scope === "unit" && unit) rows = rows.filter(r => r.unit === unit);
    return rows.slice().sort((a,b) => b.score - a.score || (a.date < b.date ? 1 : -1));
  }

  /* ---------- 스타일 (한 번만 주입) ---------- */
  function ensureStyle(){
    if (document.getElementById("kjs-score-style")) return;
    const st = document.createElement("style"); st.id = "kjs-score-style";
    st.textContent = `
    .kjs-modal-ov{position:fixed;inset:0;background:rgba(15,20,25,.55);display:grid;place-items:center;z-index:100050;padding:20px;font-family:-apple-system,"Malgun Gothic","맑은 고딕",system-ui,sans-serif;}
    .kjs-modal{background:#fffdf7;color:#1f2a1e;border-radius:16px;padding:22px 24px;max-width:340px;width:100%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.3);}
    .kjs-modal h3{margin:0 0 6px;font-size:18px;}
    .kjs-modal p{margin:0 0 14px;font-size:13px;color:#666;line-height:1.5;}
    .kjs-modal input{width:100%;box-sizing:border-box;border:1.5px solid #ddd;border-radius:10px;padding:11px 12px;font-size:16px;text-align:center;margin-bottom:12px;}
    .kjs-modal input:focus{outline:2px solid #0CA678;border-color:#0CA678;}
    .kjs-modal .kjs-btnrow{display:flex;gap:8px;}
    .kjs-modal button{flex:1;border:0;border-radius:10px;padding:11px 0;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;}
    .kjs-modal .kjs-primary{background:#1b2b2a;color:#fff;}
    .kjs-modal .kjs-skip{background:#eee;color:#555;}
    .kjs-board{background:#fffdf7;color:#1f2a1e;border:1.5px solid #e2ddd0;border-radius:14px;padding:14px 16px;margin-top:14px;text-align:left;font-family:-apple-system,"Malgun Gothic","맑은 고딕",system-ui,sans-serif;}
    .kjs-board h4{margin:0 0 4px;font-size:14px;display:flex;align-items:center;gap:6px;}
    .kjs-board .kjs-sub{font-size:11.5px;color:#8a8a8a;margin-bottom:8px;}
    .kjs-board ol{list-style:none;margin:0;padding:0;}
    .kjs-board li{display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid #f0ede4;font-size:13.5px;}
    .kjs-board li:last-child{border-bottom:0;}
    .kjs-board li.me{background:#fff6d8;border-radius:8px;}
    .kjs-board .kjs-rank{flex:none;width:22px;text-align:center;font-weight:800;color:#a08a3d;}
    .kjs-board li:nth-child(1) .kjs-rank{color:#e8900c;}
    .kjs-board .kjs-nm{flex:1;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .kjs-board .kjs-sc{font-weight:800;}
    .kjs-board .kjs-dt{flex:none;font-size:11px;color:#aaa;}
    .kjs-board .kjs-empty{font-size:12.5px;color:#999;padding:6px 2px;}
    .kjs-gatemsg{font-size:12px;color:#b5533c;margin-top:6px;}
    .kjs-tabs{display:flex;gap:4px;margin-bottom:8px;}
    .kjs-tabs button{border:1px solid #ddd6c4;background:#fff;color:#555;border-radius:999px;padding:4px 11px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;}
    .kjs-tabs button[aria-pressed="true"]{background:#1b2b2a;color:#fff;border-color:#1b2b2a;}
    `;
    document.head.appendChild(st);
  }

  /* ---------- 이름 입력 모달 ---------- */
  function promptName(){
    ensureStyle();
    return new Promise(resolve => {
      const saved = getName();
      const ov = document.createElement("div"); ov.className = "kjs-modal-ov";
      ov.innerHTML = `<div class="kjs-modal">
        <h3>🏆 이름을 알려주세요</h3>
        <p>순위표에 표시할 이름이에요. 한 번 입력하면 이 기기에서는 계속 기억해요.</p>
        <input type="text" id="kjsNameInput" maxlength="20" placeholder="예: 김과학" value="${esc(saved)}">
        <div class="kjs-btnrow">
          <button type="button" class="kjs-skip" id="kjsNameSkip">건너뛰기</button>
          <button type="button" class="kjs-primary" id="kjsNameOk">확인</button>
        </div>
      </div>`;
      document.body.appendChild(ov);
      const inp = ov.querySelector("#kjsNameInput");
      setTimeout(() => { inp.focus(); inp.select(); }, 30);
      function done(name){ ov.remove(); resolve(name); }
      ov.querySelector("#kjsNameOk").onclick = () => {
        const v = inp.value.trim(); if (v) setName(v);
        done(v || "플레이어");
      };
      ov.querySelector("#kjsNameSkip").onclick = () => done(saved || "플레이어");
      inp.addEventListener("keydown", e => { if (e.key === "Enter") ov.querySelector("#kjsNameOk").click(); });
      ov.addEventListener("click", e => { if (e.target === ov) ov.querySelector("#kjsNameOk").click(); });
    });
  }

  /* ---------- 순위표 렌더 ---------- */
  function renderRows(rows, highlightName){
    if (!rows.length) return '<p class="kjs-empty">아직 기록이 없어요. 첫 기록의 주인공이 되어 보세요!</p>';
    const medals = ["🥇","🥈","🥉"];
    return "<ol>" + rows.map((r, i) => {
      const nm = r.name || r.team || "-";
      const me = highlightName && nm === highlightName ? " me" : "";
      return `<li class="kjs-rank${me}"><span class="kjs-rank">${medals[i] || (i+1)}</span>
        <span class="kjs-nm">${esc(nm)}</span><span class="kjs-sc">${r.score}점</span>
        <span class="kjs-dt">${esc(r.date)}</span></li>`;
    }).join("") + "</ol>";
  }

  function buildBoard(kind, opts){
    ensureStyle();
    const box = document.createElement("div"); box.className = "kjs-board";
    const title = kind === "team" ? "🏆 모둠 순위" : "🏆 개인 순위";
    box.innerHTML = `<h4>${title}</h4>
      <div class="kjs-sub">이 기기에 기록된 결과예요 · <span id="kjsScopeLabel">이 차시</span></div>
      <div class="kjs-tabs">
        <button type="button" data-scope="lesson" aria-pressed="true">이 차시</button>
        <button type="button" data-scope="game" aria-pressed="false">이 게임 전체</button>
      </div>
      <div id="kjsBoardList"></div>`;
    function paint(scope){
      const rows = topRows(kind, { game: opts.game, unit: opts.unit, lesson: opts.lesson, scope: scope === "game" ? "all" : "lesson" }).slice(0, 8);
      box.querySelector("#kjsBoardList").innerHTML = renderRows(rows, opts.highlight);
      box.querySelectorAll(".kjs-tabs button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.scope === scope)));
    }
    box.querySelectorAll(".kjs-tabs button").forEach(b => b.onclick = () => paint(b.dataset.scope));
    paint("lesson");
    return box;
  }

  /* ---------- 공개 API ---------- */
  async function finishIndividual({ game, unit, lesson, score, accuracy, minAcc, container, extraNote }){
    const acc = accuracy == null ? 100 : Math.round(accuracy);
    const gate = minAcc == null ? 50 : minAcc;
    const eligible = acc >= gate;
    let name = getName();
    if (eligible) name = await promptName();
    if (eligible) {
      const db = loadDB();
      db.individual.push({ game, unit: unit||"", lesson: lesson||"", name, score: Math.round(score), accuracy: acc, date: today() });
      saveDB(db);
      const ranked = topRows("individual", { game, unit, lesson, scope: "lesson" });
      if (score > 0 && ranked.length && ranked[0].name === name && ranked[0].score === Math.round(score))
        window.KJS && KJS.win({ msg: "🏆 " + name + ", 이 차시 1위!" });
    }
    if (container) {
      container.innerHTML = "";
      if (!eligible) {
        const p = document.createElement("p"); p.className = "kjs-gatemsg";
        p.textContent = `정확도가 ${gate}% 미만이라 이번 점수는 순위표에 오르지 않았어요. 정답을 잘 확인하고 다시 도전해 보세요!`;
        container.appendChild(p);
      }
      container.appendChild(buildBoard("individual", { game, unit, lesson, highlight: eligible ? name : null }));
      if (extraNote) { const n = document.createElement("p"); n.className = "kjs-sub"; n.style.marginTop = "8px"; n.textContent = extraNote; container.appendChild(n); }
    }
    return { saved: eligible, name };
  }
  function finishTeams({ game, unit, lesson, teams, container }){
    const db = loadDB();
    (teams || []).forEach(t => {
      if (!t || !t.name) return;
      db.team.push({ game, unit: unit||"", lesson: lesson||"", team: t.name, score: Math.round(t.score||0), date: today() });
    });
    saveDB(db);
    const top = (teams || []).slice().sort((a,b) => (b.score||0)-(a.score||0))[0];
    if (top && (top.score||0) > 0) window.KJS && KJS.win({ msg: "🏆 " + top.name + " 우승!" });
    if (container) {
      container.innerHTML = "";
      const winner = (teams || []).slice().sort((a,b) => (b.score||0)-(a.score||0))[0];
      container.appendChild(buildBoard("team", { game, unit, lesson, highlight: winner ? winner.name : null }));
    }
  }

  window.KJSScore = { getName, setName, promptName, topRows, buildBoard, finishIndividual, finishTeams, today };
})();
