/* 수업 게임 서랍 · 마블(보드게임) 화면 자동 맞춤
   전자칠판·모니터·아이패드·아이폰 어느 화면이든 게임판이 스크롤 없이 한 화면에 딱 맞게 들어가도록
   게임판 크기와 모둠 전광판 배치를 자동으로 바꾼다.
   - 가로 화면(전자칠판·모니터·아이패드 가로·아이폰 가로): 모둠 카드가 게임판 좌우에 앉는 배치
   - 세로 화면(아이패드 세로·아이폰 세로): 모둠 카드가 게임판 위에 놓이는 배치
   - 두 배치 중 게임판이 더 크게 나오는 쪽을 자동 선택
   - 게임판은 기준 크기(최대 1020px)로 그린 뒤 화면에 맞게 확대·축소 → 글자·타일 비율 유지
   - 머리글에 [🎛️ 설정 접기/펴기]·[⛶ 전체화면] 버튼 추가
   필요한 요소: #teamDashboard, #boardGrid(.board-wrapper), main.game-container
*/
(function () {
  "use strict";
  if (window.__kjsMarbleFit) return; window.__kjsMarbleFit = 1;

  var board = document.getElementById("boardGrid");
  var dash = document.getElementById("teamDashboard");
  var main = board && board.closest(".game-container");
  if (!board || !dash || !main) return;

  var MAX_NATIVE = 1020;     // 원래 설계 크기
  var MIN_NATIVE = 760;      // 이보다 작게 그리면 타일 글자가 깨지므로, 이 크기로 그린 뒤 축소
  var GAP = 10;
  var bar = document.querySelector(".unit-selector-bar");
  var header = document.querySelector("header.unified-game-header");
  var LS = "kjs-marble-bar";

  /* ── 스타일 ── */
  var css = [
    "body.mf-on{padding-bottom:8px!important;overflow-x:hidden}",
    "body.mf-on .mf-stage{display:grid;width:100%;justify-content:center;align-content:start;gap:" + GAP + "px;margin:0 auto}",
    "body.mf-on #teamDashboard{display:contents}",
    "body.mf-on main.game-container{width:auto!important;max-width:none!important;flex:none!important;display:block!important;position:relative}",
    "body.mf-on #boardGrid{width:var(--mf-native)!important;max-width:none!important;height:var(--mf-native)!important;aspect-ratio:auto!important;",
    "  transform:scale(var(--mf-scale));transform-origin:0 0;margin:0!important}",
    /* 세로 배치: 카드 줄 → 게임판 */
    "body.mf-port .mf-stage{grid-template-columns:repeat(var(--mf-cols),minmax(0,1fr));width:var(--mf-side)}",
    "body.mf-port main.game-container{grid-column:1/-1}",
    "body.mf-port .team-card{padding:6px 10px!important;min-width:0}",
    /* 가로 배치: 카드 | 게임판 | 카드 */
    "body.mf-land .mf-stage{grid-template-columns:var(--mf-dash) var(--mf-side) var(--mf-dash);grid-template-rows:1fr 1fr;height:var(--mf-side);align-items:start}",
    "body.mf-land #teamDashboard>*:nth-child(n+3){align-self:end}",
    "body.mf-land main.game-container{grid-column:2;grid-row:1/span 2}",
    "body.mf-land #teamDashboard>*:nth-child(1){grid-column:1;grid-row:1}",
    "body.mf-land #teamDashboard>*:nth-child(2){grid-column:3;grid-row:1}",
    "body.mf-land #teamDashboard>*:nth-child(3){grid-column:1;grid-row:2}",
    "body.mf-land #teamDashboard>*:nth-child(4){grid-column:3;grid-row:2}",
    "body.mf-land .team-card{flex-direction:column;align-items:flex-start;gap:6px!important;min-width:0}",
    "body.mf-land.mf-tight .team-card{padding:6px 8px!important}",
    "body.mf-land.mf-tight .team-card *{font-size:max(11px,.92em)}",
    /* 작은 화면(아이폰·작은 태블릿): 머리글 한 줄 + 슬림 모둠 카드 */
    "body.mf-compact{padding:4px 6px 4px!important}",
    "body.mf-slimhead header.unified-game-header{flex-wrap:nowrap!important;padding:5px 8px!important;gap:8px!important;margin-bottom:6px!important;border-radius:12px!important}",
    "body.mf-slimhead header.unified-game-header .game-badge{display:none!important}",
    "body.mf-slimhead header.unified-game-header .game-title{font-size:15px!important;white-space:nowrap}",
    "body.mf-slimhead header.unified-game-header .header-brand{flex:none}",
    "body.mf-slimhead .unified-nav-actions{flex:1;min-width:0;flex-wrap:nowrap!important;overflow-x:auto;justify-content:flex-start;scrollbar-width:none;-webkit-overflow-scrolling:touch}",
    "body.mf-slimhead .unified-nav-actions::-webkit-scrollbar{display:none}",
    "body.mf-slimhead .unified-nav-actions>*{flex:none;padding:5px 9px!important;font-size:12px!important;white-space:nowrap}",
    "body.mf-compact .team-card{flex-direction:row!important;align-items:center!important;padding:4px 8px!important;gap:6px!important;border-radius:10px!important}",
    "body.mf-compact .team-avatar{width:30px!important;height:30px!important;font-size:18px!important;border-radius:8px!important;flex:none}",
    "body.mf-compact .team-stats{display:none!important}",
    "body.mf-compact .team-name{font-size:12px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    "body.mf-compact .team-pts{font-size:14px!important}",
    "body.mf-compact .team-info{min-width:0}",
    "body.mf-compact .team-card::after,body.mf-compact .team-card::before{font-size:9px!important;padding:1px 5px!important}",
    /* 설정 막대 접기 */
    "body.mf-bar-hidden .unit-selector-bar{display:none!important}",
    ".mf-btn{white-space:nowrap}",
    "@media print{.mf-btn{display:none!important}}"
  ].join("\n");
  var st = document.createElement("style"); st.id = "kjs-marble-fit-style"; st.textContent = css;
  document.head.appendChild(st);

  /* ── 무대(stage) 만들기: 전광판과 게임판을 한 격자에 ── */
  var stage = document.createElement("div"); stage.className = "mf-stage";
  dash.parentNode.insertBefore(stage, dash);
  stage.appendChild(dash); stage.appendChild(main);
  document.body.classList.add("mf-on");

  /* ── 머리글 버튼 ── */
  var nav = header && (header.querySelector(".unified-nav-actions") || header);
  function mkBtn(label, title, fn) {
    var b = document.createElement("button"); b.type = "button";
    b.className = "btn-unified-nav mf-btn"; b.textContent = label; b.title = title;
    b.addEventListener("click", function (e) { e.stopPropagation(); fn(b); });
    if (nav) nav.insertBefore(b, nav.firstChild);
    return b;
  }
  var bBar = null;
  function paintBar() {
    if (!bBar) return;
    var hidden = document.body.classList.contains("mf-bar-hidden");
    bBar.textContent = hidden ? "🎛️ 설정 ▾" : "🎛️ 설정 ▴";
    bBar.title = hidden ? "단원·참여 설정 막대 보이기" : "단원·참여 설정 막대를 접어 게임판을 크게";
  }
  if (bar) {
    var saved = null; try { saved = localStorage.getItem(LS); } catch (e) {}
    var hideDefault = saved ? saved === "hide" : (window.innerHeight < 820 || window.innerWidth < 700);
    if (hideDefault) document.body.classList.add("mf-bar-hidden");
    bBar = mkBtn("", "", function () {
      document.body.classList.toggle("mf-bar-hidden");
      try { localStorage.setItem(LS, document.body.classList.contains("mf-bar-hidden") ? "hide" : "show"); } catch (e) {}
      paintBar(); fit();
    });
    paintBar();
  }
  var root = document.documentElement;
  var reqFS = root.requestFullscreen || root.webkitRequestFullscreen;
  if (reqFS) {
    var bFS = mkBtn("⛶ 전체", "전자칠판에서 게임판을 화면 가득히", function () {
      var on = document.fullscreenElement || document.webkitFullscreenElement;
      if (on) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else { try { var r = reqFS.call(root); if (r && r.catch) r.catch(function () {}); } catch (e) {} }
    });
    var paintFS = function () {
      var on = document.fullscreenElement || document.webkitFullscreenElement;
      bFS.textContent = on ? "⤢ 창" : "⛶ 전체"; setTimeout(fit, 120);
    };
    document.addEventListener("fullscreenchange", paintFS);
    document.addEventListener("webkitfullscreenchange", paintFS);
  }

  /* ── 크기 계산 ── */
  function vp() {
    var v = window.visualViewport;
    return { w: Math.floor(v ? v.width : window.innerWidth), h: Math.floor(v ? v.height : window.innerHeight) };
  }
  function cardCount() { return Math.max(1, dash.children.length); }
  function setVars(mode, side, extra) {
    var b = document.body;
    b.classList.toggle("mf-land", mode === "land");
    b.classList.toggle("mf-port", mode === "port");
    var native = Math.max(MIN_NATIVE, Math.min(MAX_NATIVE, side));
    stage.style.setProperty("--mf-side", side + "px");
    main.style.width = side + "px"; main.style.height = side + "px";
    board.style.setProperty("--mf-native", native + "px");
    board.style.setProperty("--mf-scale", String(side / native));
    if (extra) for (var k in extra) stage.style.setProperty(k, extra[k]);
  }
  var busy = false;
  function fit() {
    if (busy) return; busy = true;
    try {
      var v = vp();
      document.body.classList.toggle("mf-compact", v.w < 900 || v.h < 560);
      document.body.classList.toggle("mf-slimhead", v.w < 1500 || v.h < 560);
      var bs = getComputedStyle(document.body);
      var padX = parseFloat(bs.paddingLeft) + parseFloat(bs.paddingRight);
      var top = stage.getBoundingClientRect().top + (window.scrollY || 0);
      var availH = v.h - top - 10;
      var availW = v.w - padX;
      var n = cardCount();

      /* 가로 배치: 카드 폭은 화면의 14~22% (160~320px) */
      var dashW = Math.max(150, Math.min(320, Math.round(v.w * 0.17)));
      var sideLand = Math.floor(Math.min(availH, availW - 2 * dashW - 2 * GAP));
      var roomSide = (availW - sideLand - 2 * GAP) / 2;         // 남는 폭을 카드에 나눠 줌
      if (roomSide > dashW) dashW = Math.min(360, Math.floor(roomSide));

      /* 세로 배치: 카드 줄 높이를 실제로 재서 계산 */
      var cols = (availW >= 720 && n >= 3) ? Math.min(4, n) : Math.min(2, n);
      setVars("port", Math.floor(Math.min(availW, 600)), { "--mf-cols": String(cols) });
      var firstCard = dash.children[0];
      var rows = Math.ceil(n / cols);
      var cardH = firstCard ? firstCard.getBoundingClientRect().height : 70;
      var dashH = rows * cardH + rows * GAP;
      var sidePort = Math.floor(Math.min(availW, availH - dashH));

      if (sideLand >= sidePort && sideLand > 0) {
        setVars("land", sideLand, { "--mf-dash": dashW + "px" });
        document.body.classList.toggle("mf-tight", dashW < 210);
      } else {
        setVars("port", Math.max(240, sidePort), { "--mf-cols": String(cols) });
        document.body.classList.remove("mf-tight");
      }
    } catch (e) {}
    busy = false;
  }

  /* ── 다시 맞추는 시점 ── */
  var t = null;
  function later() { clearTimeout(t); t = setTimeout(fit, 60); }
  window.addEventListener("resize", later);
  window.addEventListener("orientationchange", function () { setTimeout(fit, 250); });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", later);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(later);
    if (header) ro.observe(header);
    if (bar) ro.observe(bar);
  }
  if (window.MutationObserver) new MutationObserver(later).observe(dash, { childList: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  window.addEventListener("load", fit);
  window.KJSMarbleFit = { fit: fit };
  fit();
})();
