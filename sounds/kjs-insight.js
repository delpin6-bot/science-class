/* 수업 게임 서랍 · 오답 분석 모듈 (원칙 ②③)
   KJSInsight.begin({game, gameName, unit, lesson})   게임 시작 때 호출
   KJSInsight.hit(term)                                정답
   KJSInsight.miss(term, desc, detail)                 오답·놓침 (detail: '헷갈린 답' 등)
   KJSInsight.hint(term)                               힌트 사용
   KJSInsight.report(container)                        게임 종료 화면에 "오답 TOP" 표시
   KJSInsight.chosung(word)                            초성 힌트 문자열
   KJSInsight.renderDashboard(container)               교사용 대시보드(모든 게임 누적)
   기록은 이 기기 브라우저(localStorage)에 누적됩니다.
*/
(function(){
  const LS = "kjs-insight-v1";
  const CAP = 6000;
  const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
  const esc = s => String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;");

  function chosung(word){
    return String(word).split("").map(ch => {
      const c = ch.charCodeAt(0);
      if (c >= 0xAC00 && c <= 0xD7A3) return CHO[Math.floor((c - 0xAC00) / 588)];
      return ch === " " ? " " : ch;
    }).join("");
  }
  function today(){
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function load(){ try { return JSON.parse(localStorage.getItem(LS) || "[]"); } catch(e){ return []; } }
  function save(rows){ try { localStorage.setItem(LS, JSON.stringify(rows.slice(-CAP))); } catch(e){} }

  let S = null;   // 현재 판(세션)
  function begin(meta){
    S = Object.assign({ game: "", gameName: "", unit: "", lesson: "" }, meta || {}, { terms: {}, date: today() });
  }
  function T(term, desc){
    if (!S) begin({});
    const k = String(term);
    if (!S.terms[k]) S.terms[k] = { term: k, desc: desc || "", hit: 0, miss: 0, hint: 0, confused: {} };
    if (desc && !S.terms[k].desc) S.terms[k].desc = desc;
    return S.terms[k];
  }
  function hit(term, desc){ T(term, desc).hit++; }
  function miss(term, desc, detail){
    const t = T(term, desc); t.miss++;
    if (detail) t.confused[detail] = (t.confused[detail] || 0) + 1;
  }
  function hint(term, desc){ T(term, desc).hint++; }

  /* 세션을 누적 저장 (게임 종료 때 한 번) */
  function commit(){
    if (!S) return;
    const rows = load();
    Object.values(S.terms).forEach(t => {
      if (!t.hit && !t.miss && !t.hint) return;
      rows.push({ d: S.date, g: S.game, gn: S.gameName, u: S.unit, l: S.lesson, t: t.term, s: t.desc,
                  h: t.hit, m: t.miss, k: t.hint, c: Object.keys(t.confused).slice(0, 3) });
    });
    save(rows);
  }
  function topOfSession(n){
    if (!S) return [];
    return Object.values(S.terms).filter(t => t.miss + t.hint > 0)
      .sort((a,b) => (b.miss*2 + b.hint) - (a.miss*2 + a.hint)).slice(0, n || 3);
  }

  function ensureStyle(){
    if (document.getElementById("kjs-insight-style")) return;
    const st = document.createElement("style"); st.id = "kjs-insight-style";
    st.textContent = `
    .kjs-ins{background:#fff8ec;color:#2b2518;border:1.5px solid #f0c987;border-radius:14px;padding:13px 15px;margin:12px 0;text-align:left;
      font-family:-apple-system,"Malgun Gothic","맑은 고딕",system-ui,sans-serif;}
    .kjs-ins h4{margin:0 0 3px;font-size:14.5px;}
    .kjs-ins .sub{font-size:11.5px;color:#8a7a5a;margin-bottom:8px;}
    .kjs-ins ol{margin:0;padding:0;list-style:none;}
    .kjs-ins li{padding:7px 0;border-top:1px dashed #efd9b1;font-size:13px;line-height:1.45;}
    .kjs-ins li:first-child{border-top:0;}
    .kjs-ins .rk{display:inline-block;min-width:20px;font-weight:900;color:#c2410c;}
    .kjs-ins .tm{font-weight:800;font-size:14.5px;}
    .kjs-ins .ds{display:block;color:#6b5d40;font-size:12.5px;margin:2px 0 0 20px;}
    .kjs-ins .cf{display:block;color:#b45309;font-size:11.5px;margin:2px 0 0 20px;}
    .kjs-ins .ok{font-size:13px;color:#15803d;font-weight:700;}
    .kjs-ins .tbtn{margin-top:8px;border:1px solid #e0b872;background:#fff;color:#7c5a1a;border-radius:999px;padding:5px 12px;
      font:inherit;font-size:12px;font-weight:800;cursor:pointer;}
    .kjs-ins .cum{margin-top:8px;}
    .kjs-ins table{width:100%;border-collapse:collapse;font-size:12px;}
    .kjs-ins th,.kjs-ins td{padding:5px 4px;border-bottom:1px solid #f1e3c8;text-align:left;}
    .kjs-ins th{color:#8a7a5a;font-weight:800;}
    .kjs-ins .bar{height:7px;border-radius:4px;background:#fb923c;display:inline-block;vertical-align:middle;}`;
    document.head.appendChild(st);
  }

  /* 누적 집계: 조건에 맞는 기록을 개념별로 합산해 오답률 순으로 */
  function aggregate(filter){
    const map = {};
    load().filter(r => !filter || filter(r)).forEach(r => {
      const k = r.g + "|" + r.t;
      if (!map[k]) map[k] = { game: r.gn || r.g, unit: r.u, lesson: r.l, term: r.t, desc: r.s, hit: 0, miss: 0, hint: 0, plays: 0, conf: {} };
      const a = map[k]; a.hit += r.h; a.miss += r.m; a.hint += r.k; a.plays++;
      (r.c || []).forEach(c => a.conf[c] = (a.conf[c] || 0) + 1);
      if (r.l) a.lesson = r.l;
    });
    return Object.values(map).map(a => {
      const tries = a.hit + a.miss;
      a.rate = tries ? a.miss / tries : (a.hint ? 1 : 0);
      a.confTop = Object.keys(a.conf).filter(k => k !== "놓침").sort((x,y) => a.conf[y] - a.conf[x]).slice(0, 2);
      return a;
    }).filter(a => a.miss + a.hint > 0).sort((x,y) => y.rate - x.rate || y.miss - x.miss);
  }

  function rowsTable(list, showGame){
    if (!list.length) return '<p class="ok">아직 쌓인 오답 기록이 없어요.</p>';
    return "<table><tr>" + (showGame ? "<th>게임</th>" : "") + "<th>개념</th><th>오답률</th><th>오답</th><th>힌트</th><th>헷갈린 답</th></tr>" +
      list.map(a => "<tr>" + (showGame ? "<td>" + esc(a.game) + "</td>" : "") +
        "<td><b>" + esc(a.term) + "</b></td>" +
        "<td><span class='bar' style='width:" + Math.round(a.rate * 50) + "px'></span> " + Math.round(a.rate * 100) + "%</td>" +
        "<td>" + a.miss + "</td><td>" + a.hint + "</td><td>" + esc(a.confTop.join(", ")) + "</td></tr>").join("") + "</table>";
  }

  /* 게임 종료 화면: 이번 판 오답 TOP 3 + (교사용) 이 차시 누적 */
  function report(container){
    if (!container) return;
    ensureStyle();
    const top = topOfSession(3);
    const meta = S || {};
    commit();
    const box = document.createElement("div"); box.className = "kjs-ins";
    let html = "<h4>📌 다시 볼 개념 (이번 판 오답 TOP 3)</h4>" +
      "<div class='sub'>틀리거나 놓치거나 힌트를 쓴 개념이에요. 설명을 소리 내어 한 번 더 읽어 보세요.</div>";
    if (!top.length) html += "<p class='ok'>🎉 이번 판에서는 틀린 개념이 없어요!</p>";
    else html += "<ol>" + top.map((t, i) =>
      "<li><span class='rk'>" + (i+1) + "</span><span class='tm'>" + esc(t.term) + "</span>" +
      (t.desc ? "<span class='ds'>" + esc(t.desc) + "</span>" : "") +
      "<span class='cf'>" + (function(){
        const lost = t.confused["놓침"] || 0;
        const conf = Object.keys(t.confused).filter(k => k !== "놓침");
        const wrong = t.miss - lost;
        const parts = [];
        if (wrong) parts.push("오답 " + wrong + "회");
        if (lost) parts.push("놓침 " + lost + "회");
        if (t.hint) parts.push("힌트 " + t.hint + "회");
        if (conf.length) parts.push("헷갈린 답: " + esc(conf.slice(0,2).join(", ")));
        return parts.join(" · ");
      })() + "</span></li>").join("") + "</ol>";
    html += "<button type='button' class='tbtn'>👩‍🏫 교사용: 이 차시 누적 오답 보기</button><div class='cum' hidden></div>";
    box.innerHTML = html;
    container.appendChild(box);
    const btn = box.querySelector(".tbtn"), cum = box.querySelector(".cum");
    btn.onclick = () => {
      cum.hidden = !cum.hidden;
      if (!cum.hidden) {
        const list = aggregate(r => r.g === meta.game && r.l === meta.lesson).slice(0, 8);
        cum.innerHTML = "<div class='sub' style='margin-top:6px'>이 기기에서 이 차시를 한 모든 판을 합친 결과예요.</div>" + rowsTable(list, false);
      }
    };
  }

  /* 교사용 대시보드 (모든 게임) */
  function renderDashboard(container){
    ensureStyle();
    const all = load();
    const games = [...new Set(all.map(r => r.gn || r.g))];
    const units = [...new Set(all.map(r => r.u).filter(Boolean))];
    const dates = [...new Set(all.map(r => r.d))].sort().reverse();
    container.innerHTML =
      "<div class='kjs-ins'><h4>🔎 필터</h4>" +
      "<select id='insG'><option value=''>모든 게임</option>" + games.map(g => "<option>" + esc(g) + "</option>").join("") + "</select> " +
      "<select id='insU'><option value=''>모든 단원</option>" + units.map(u => "<option>" + esc(u) + "</option>").join("") + "</select> " +
      "<select id='insD'><option value=''>전체 기간</option>" + dates.map(d => "<option>" + d + "</option>").join("") + "</select>" +
      "<div class='sub' style='margin-top:8px'>기록 " + all.length + "건 · 이 기기 브라우저에 쌓인 결과</div></div>" +
      "<div class='kjs-ins' id='insTop'></div>" +
      "<div class='kjs-ins'><h4>📋 전체 오답 순위</h4><div id='insTable'></div>" +
      "<button type='button' class='tbtn' id='insCsv'>⬇ CSV로 내려받기</button> " +
      "<button type='button' class='tbtn' id='insReset'>🗑 기록 모두 지우기</button></div>";
    function draw(){
      const g = container.querySelector("#insG").value, u = container.querySelector("#insU").value, d = container.querySelector("#insD").value;
      const list = aggregate(r => (!g || (r.gn || r.g) === g) && (!u || r.u === u) && (!d || r.d === d));
      const top = list[0];
      container.querySelector("#insTop").innerHTML = top
        ? "<h4>🥇 오답률 1위 개념 — 지금 바로 짚어 주세요</h4><div style='font-size:24px;font-weight:900;margin:6px 0'>" + esc(top.term) + "</div>" +
          "<div style='font-size:14px'>" + esc(top.desc) + "</div>" +
          "<div class='sub' style='margin-top:6px'>" + esc(top.game) + " · " + esc(top.unit) + " " + esc(top.lesson) +
          " · 오답률 " + Math.round(top.rate*100) + "% (오답 " + top.miss + "회, 힌트 " + top.hint + "회)" +
          (top.confTop.length ? " · 학생들이 대신 고른 답: " + esc(top.confTop.join(", ")) : "") + "</div>"
        : "<h4>🥇 오답률 1위 개념</h4><p class='ok'>아직 기록이 없어요. 학생들이 게임을 한 뒤 다시 열어 보세요.</p>";
      container.querySelector("#insTable").innerHTML = rowsTable(list.slice(0, 30), !g);
      container._list = list;
    }
    ["#insG","#insU","#insD"].forEach(s => container.querySelector(s).onchange = draw);
    container.querySelector("#insCsv").onclick = () => {
      const list = container._list || [];
      const lines = [["게임","단원","차시","개념","설명","오답률(%)","오답","정답","힌트","헷갈린 답"].join(",")].concat(
        list.map(a => [a.game, a.unit, a.lesson, a.term, a.desc, Math.round(a.rate*100), a.miss, a.hit, a.hint, a.confTop.join("/")]
          .map(x => '"' + String(x).replace(/"/g,'""') + '"').join(",")));
      const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "오답분석_" + today() + ".csv"; a.click();
    };
    container.querySelector("#insReset").onclick = () => {
      if (confirm("이 기기의 오답 기록을 모두 지울까요? 되돌릴 수 없어요.")) { save([]); renderDashboard(container); }
    };
    draw();
  }

  window.KJSInsight = { begin, hit, miss, hint, report, chosung, aggregate, renderDashboard, _session: () => S };
})();
