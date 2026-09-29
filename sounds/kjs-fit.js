/* 수업 게임 서랍 · 모든 게임 화면 자동 맞춤 (전자칠판·모니터·아이패드·아이폰)
   ─ 머리글 아래의 게임 화면 전체를 한 덩어리(무대)로 묶어, 스크롤 없이 화면에 딱 맞게 확대·축소한다.
   ─ 화면이 좁으면 게임 화면을 더 넓게 펼쳐 그린 뒤 줄여서, 세로로 길게 늘어지지 않고 판 모양을 유지한다.
   ─ 게임 화면이 바뀌면(메뉴→게임→결과) 자동으로 다시 맞춘다.
   ─ 차시 고르기 목록처럼 원래 길게 내려 보는 화면은 억지로 줄이지 않고 스크롤을 그대로 둔다.
   ─ 끄기: <script src="./sounds/kjs-fit.js" data-fit="off">  또는  <body data-no-fit>
   ─ 마블 게임은 전용 kjs-marble-fit.js 를 쓴다.
*/
(function () {
  "use strict";
  if (window.__kjsFit) return; window.__kjsFit = 1;
  var SELF = document.currentScript;
  if (SELF && SELF.getAttribute("data-fit") === "off") return;

  var MIN_SCALE = 0.5;       // 이보다 더 줄여야 하는 화면은 '긴 화면'으로 보고 스크롤 유지
  var MIN_SCALE_SMALL = 0.42;// 휴대폰은 조금 더 줄이는 것을 허용
  var MIN_SCALE_SHORT = 0.42;// 휴대폰 가로(높이 아주 낮음)
  var MAX_UP = 1.6;          // 큰 전자칠판에서 확대 한도
  var WIDEN = [1, 1.2, 1.45, 1.75, 2.1];   // 좁은 화면에서 펼쳐 그릴 폭 배율 후보
  var HEAD = "header.unified-game-header, header.master, header.kjs-topbar";
  var LEAF = "canvas,svg,img,video,button,input,select,textarea,progress,meter,iframe";

  function start() {
    if (document.body.hasAttribute("data-no-fit") || document.querySelector('script[src*="kjs-marble-fit"]')) return;
    var body = document.body;

    /* ── 1. 무대 만들기 ── */
    var kids = Array.prototype.slice.call(body.children);
    var i = 0;
    function skip(e) {
      var t = e.tagName;
      if (t === "SCRIPT" || t === "STYLE" || t === "LINK" || t === "TEMPLATE" || t === "NOSCRIPT") return true;
      var p = getComputedStyle(e).position;
      return p === "fixed" || p === "absolute";
    }
    /* 맨 앞의 머리글·고정 막대는 무대 밖에 둔다 */
    while (i < kids.length && (skip(kids[i]) || kids[i].matches(HEAD) ||
           getComputedStyle(kids[i]).position === "sticky")) i++;
    var content = kids.slice(i).filter(function (e) { return !skip(e); });
    if (!content.length) return;
    var stage = document.createElement("div");
    stage.className = "kf-stage";
    body.insertBefore(stage, content[0]);
    content.forEach(function (e) { stage.appendChild(e); });

    /* body 의 배치 방식(flex 등)을 무대에 그대로 옮겨 원래 모양을 유지 */
    var bs = getComputedStyle(body);
    if (bs.display.indexOf("flex") >= 0 || bs.display.indexOf("grid") >= 0) {
      stage.style.display = bs.display.indexOf("grid") >= 0 ? "grid" : "flex";
      ["flexDirection", "alignItems", "justifyContent", "gap", "rowGap", "columnGap", "flexWrap",
       "gridTemplateColumns", "gridTemplateRows", "alignContent", "justifyItems"].forEach(function (k) {
        if (bs[k] && bs[k] !== "normal") stage.style[k] = bs[k];
      });
    }
    var st = document.createElement("style"); st.id = "kjs-fit-style";
    st.textContent = [
      ".kf-stage{box-sizing:border-box;flex:none;margin-left:auto;margin-right:auto;align-self:center;max-width:none;position:relative}",
      "html.kf-fit body{min-height:0!important}",
      "html.kf-fit,html.kf-fit body{overflow-x:clip!important}",
      /* 높이가 낮은 화면(휴대폰 가로): 머리글을 얇게 */
      "html.kf-short header.unified-game-header{padding-top:3px!important;padding-bottom:3px!important;min-height:0!important;row-gap:4px!important}",
      "html.kf-short header.unified-game-header :is(button,a){padding-top:3px!important;padding-bottom:3px!important;min-height:0!important;height:auto!important;font-size:12px!important}",
      "html.kf-short header.unified-game-header .game-badge{display:none!important}",
      "@media print{.kf-stage{zoom:1!important;width:auto!important}}"
    ].join("\n");
    document.head.appendChild(st);

    /* ── 2. 전체화면 버튼 ── */
    var nav = document.querySelector(".unified-nav-actions");
    var root = document.documentElement, reqFS = root.requestFullscreen || root.webkitRequestFullscreen;
    var hasFS = Array.prototype.some.call(document.querySelectorAll("button"), function (b) { return /전체\s*화면|⛶/.test(b.textContent); });
    if (nav && reqFS && !hasFS) {
      var bFS = document.createElement("button"); bFS.type = "button";
      bFS.className = "btn-top btn-unified-nav kf-fs"; bFS.textContent = "⛶ 전체"; bFS.title = "전자칠판에서 게임 화면을 가득히";
      bFS.addEventListener("click", function (e) {
        e.stopPropagation();
        var on = document.fullscreenElement || document.webkitFullscreenElement;
        if (on) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else { try { var r = reqFS.call(root); if (r && r.catch) r.catch(function () {}); } catch (x) {} }
      });
      var paint = function () { var on = document.fullscreenElement || document.webkitFullscreenElement; bFS.textContent = on ? "⤢ 창" : "⛶ 전체"; later(150); };
      document.addEventListener("fullscreenchange", paint); document.addEventListener("webkitfullscreenchange", paint);
      nav.insertBefore(bFS, nav.firstChild);
    }

    /* ── 3. 측정 ── */
    var cur = { w: 0, s: 1 }, memo = {};           // 지금 적용된 펼침 폭(0 = 자동)·배율
    function vp() {
      var v = window.visualViewport;
      return { w: Math.floor(v ? v.width : window.innerWidth), h: Math.floor(v ? v.height : window.innerHeight) };
    }
    function visible(e) {
      if (e.offsetParent === null && getComputedStyle(e).position !== "fixed") return false;
      return true;
    }
    /* 무대 안 실제 내용물(글자·버튼·그림)이 차지하는 범위를 '무대 좌표'로 잰다 */
    function extent() {
      var sr = stage.getBoundingClientRect();
      var k = stage.offsetWidth ? sr.width / stage.offsetWidth : 1;   // 화면에 보이는 배율
      if (!k) k = 1;
      var minX = Infinity, maxX = -Infinity, maxY = -Infinity;
      var all = stage.getElementsByTagName("*");
      /* 스크롤 상자 안에 가려진 내용은 상자 끝까지만 센다 */
      var SC = [];
      for (var q = 0; q < all.length; q++) {
        var el = all[q];
        if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) {
          var ov = getComputedStyle(el);
          if (ov.overflowY !== "visible" || ov.overflowX !== "visible") SC.push([el, el.getBoundingClientRect(), ov.overflowY !== "visible", ov.overflowX !== "visible"]);
        }
      }
      for (var n = 0; n < all.length; n++) {
        var e = all[n];
        var leaf = e.matches(LEAF) || !e.firstElementChild;   /* 빈 칸·카드처럼 자식 없는 상자도 내용물 */
        if (!leaf) {
          var tx = false;
          for (var c = e.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && c.nodeValue.trim()) { tx = true; break; }
          if (!tx) continue;
        }
        if (e.closest("svg") && e.tagName.toLowerCase() !== "svg") continue;
        var cs = getComputedStyle(e);
        if (cs.position === "fixed" || cs.visibility === "hidden" || cs.display === "none") continue;
        var r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        var L = r.left, R = r.right, B = r.bottom, T = r.top;
        for (var j = 0; j < SC.length; j++) {
          if (SC[j][0] !== e && SC[j][0].contains(e)) {
            var cr = SC[j][1];
            if (SC[j][2]) { B = Math.min(B, cr.bottom); T = Math.max(T, cr.top); }
            if (SC[j][3]) { R = Math.min(R, cr.right); L = Math.max(L, cr.left); }
          }
        }
        if (B <= T || R <= L) continue;
        /* 머리글 줄(버튼 막대)은 화면 폭을 다 쓰므로 폭 계산에서는 뺀다 */
        if (!e.closest(".kjs-topbar, .unified-nav-actions, .kjs-seg, header")) { if (L < minX) minX = L; if (R > maxX) maxX = R; }
        if (B > maxY) maxY = B;
      }
      if (maxY === -Infinity) return null;
      if (maxX === -Infinity) { minX = sr.left; maxX = sr.right; }
      var pad = 14;
      return {
        h: (maxY - sr.top) / k + pad,                         // 무대 위쪽부터 내용 끝까지
        w: Math.max(0, (maxX - minX) / k) + 2 * pad,          // 내용이 실제로 차지하는 폭
        box: stage.offsetHeight                                // 무대 상자 높이(여백 포함)
      };
    }
    function avail() {
      var v = vp();
      var bsx = getComputedStyle(body);
      var sr = stage.getBoundingClientRect();
      var top = sr.top + (window.scrollY || 0);
      var bottomPad = parseFloat(bsx.paddingBottom) || 0;
      return {
        w: Math.max(200, (document.documentElement.clientWidth || v.w) - (parseFloat(bsx.paddingLeft) || 0) - (parseFloat(bsx.paddingRight) || 0)),
        h: Math.max(160, v.h - top - Math.min(bottomPad, 12) - 4),
        small: Math.min(v.w, v.h) < 560,
        short: v.h < 500
      };
    }
    function apply(w, s) {
      stage.style.width = w ? w + "px" : "";
      stage.style.zoom = s === 1 ? "" : String(s);
      cur.w = w; cur.s = s;
      document.documentElement.classList.toggle("kf-fit", s !== 1 || !!w);
    }

    /* ── 4. 맞추기 ── */
    var mo = null, ro = null, busy = false;
    function disconnect() { if (mo) mo.disconnect(); if (ro) ro.disconnect(); }
    function connect() {
      if (mo) { mo.takeRecords(); mo.observe(stage, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] }); }
      if (ro) { ro.observe(document.documentElement); }
    }
    var MENU = ".km-card, #home.screen.on, [data-kf-menu]";
    function menuShown() {
      var m = stage.querySelectorAll(MENU);
      for (var n = 0; n < m.length; n++) { var r = m[n].getBoundingClientRect(); if (r.width > 0 && r.height > 0) return true; }
      return false;
    }
    function overflow() {
      var d = document.documentElement, v = vp();
      return { y: d.scrollHeight - v.h, x: d.scrollWidth - v.w };
    }
    /* 적용 뒤 실제로 넘치는 만큼 조금씩 더 줄여 딱 맞춘다(여백·100vh 상자 보정) */
    function fits() {   /* 가로는 무대 폭으로 판단(100vw 장식 막대가 확대되어 생기는 넘침은 잘라 냄) */
      var o = overflow(), r = stage.getBoundingClientRect();
      return o.y <= 1 && r.right <= vp().w + 1 && r.left >= -1;
    }
    function correct(minS) {
      if (fits()) return true;
      var hi = cur.s, lo = minS, w = cur.w;
      apply(w, lo); if (!fits()) return false;
      for (var n = 0; n < 8; n++) {                      /* 넘치지 않는 가장 큰 배율을 반씩 좁혀 찾기 */
        var mid = Math.floor((lo + hi) / 2 * 1000) / 1000;
        apply(w, mid);
        if (fits()) lo = mid; else hi = mid;
        if (hi - lo < 0.005) break;
      }
      apply(w, lo); return true;
    }
    function solve() {
      document.documentElement.classList.toggle("kf-short", vp().h < 500);
      var A = avail();
      var minS = A.short ? MIN_SCALE_SHORT : A.small ? MIN_SCALE_SMALL : MIN_SCALE;
      /* 1) 원래 모양 그대로 재 보기 */
      apply(0, 1);
      /* 차시 고르기 목록(메뉴)이 보이는 동안은 줄이지 않고 스크롤로 고르게 둔다 */
      if (menuShown()) return;
      var E = extent(); if (!E) return;
      var sig = [Math.round(E.h), Math.round(E.w), E.box, A.w, A.h].join("|");
      if (memo.sig === sig) { apply(memo.w, memo.s); if (memo.s !== 1 || memo.w) correct(minS); return; }   // 같은 화면 → 지난 결과 재사용
      memo.sig = sig;
      try { solveInner(A, minS, E); } finally { memo.w = cur.w; memo.s = cur.s; }
    }
    var hinted = false;
    function rotateHint(A) {        /* 휴대폰 가로에서 다 못 담으면 세로로 돌리도록 한 번 안내 */
      var v = vp();
      if (hinted || !A.short || v.w > 950 || !(window.matchMedia && matchMedia("(pointer:coarse)").matches)) return;
      hinted = true;
      var d = document.createElement("div");
      d.textContent = "📱 휴대폰을 세로로 돌리면 게임 화면이 한눈에 들어와요";
      d.style.cssText = "position:fixed;left:50%;bottom:calc(10px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:100070;" +
        "background:#0f172a;color:#fff;font:800 13px/1.3 -apple-system,'Malgun Gothic',sans-serif;padding:9px 14px;border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,.3);white-space:nowrap";
      document.body.appendChild(d); setTimeout(function () { d.remove(); }, 3500);
    }
    function solveInner(A, minS, E) {
      if (E.h <= A.h + 1) {
        /* 넉넉함 → 큰 화면이면 확대(폭을 줄여 그린 뒤 키움) */
        var up = Math.min(MAX_UP, A.w / Math.max(E.w, 1), A.h / Math.max(E.h, 1));
        var okUp = false;
        for (var k = 0; k < 5 && up > 1.06; k++) {      /* 확대한 폭에서 다시 재어 가며 딱 맞는 배율 찾기 */
          up = Math.floor(up * 100) / 100;
          apply(Math.floor(A.w / up), 1);
          var e1 = extent(); if (!e1) break;
          var fitUp = Math.min(A.h / e1.h, A.w / Math.max(e1.w, 1), MAX_UP);
          if (fitUp >= up - 0.005) { apply(Math.floor(A.w / up), up); okUp = true; break; }
          up = fitUp;
        }
        if (!okUp) apply(0, 1);
        if (!correct(minS)) apply(0, 1);
        return;
      }
      /* 2) 넘침 → 넓게 펼쳐 그린 뒤 줄이기: 가장 크게 보이는 폭 선택 */
      var best = { w: 0, s: Math.min(1, A.h / E.h) };
      for (var n = 1; n < WIDEN.length; n++) {
        var W = Math.round(A.w * WIDEN[n]);
        apply(W, 1);
        var e2 = extent(); if (!e2) continue;
        var s2 = Math.min(A.w / W, A.h / e2.h);
        if (s2 > best.s + 0.005) best = { w: W, s: s2 };
        if (A.w / W < best.s) break;       // 더 넓혀도 좋아질 수 없음
      }
      if (best.s < minS) { apply(0, 1); rotateHint(A); return; }   // 긴 화면: 스크롤 유지
      apply(best.w, Math.floor(best.s * 1000) / 1000);
      if (!correct(minS)) apply(0, 1);
    }
    function fit(force) {
      if (busy) return; busy = true;
      disconnect();
      try {
        if (!force && cur.s !== 1) {
          /* 읽기만 해서 지금 배율이 여전히 맞는지 확인 → 맞으면 손대지 않음(깜빡임 방지) */
          var A = avail(), E = extent();
          if (E) {
            var needH = E.h * cur.s, ok = fits() && needH >= A.h * 0.93;
            if (ok) { busy = false; connect(); return; }
          }
        }
        solve();
      } catch (x) {}
      busy = false;
      connect();
    }

    var t = null, last = 0;
    function later(ms) {
      clearTimeout(t);
      t = setTimeout(function () {
        var now = Date.now();
        if (now - last < 300) { later(300 - (now - last)); return; }
        last = now; fit(false);
      }, ms || 120);
    }
    if (window.MutationObserver) mo = new MutationObserver(function () { later(160); });
    if (window.ResizeObserver) ro = new ResizeObserver(function () { later(80); });
    window.addEventListener("resize", function () { later(80); });
    window.addEventListener("orientationchange", function () { setTimeout(function () { fit(true); }, 300); });
    if (window.visualViewport) window.visualViewport.addEventListener("resize", function () { later(80); });
    window.addEventListener("load", function () { fit(true); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fit(true); });
    window.KJSFit = { fit: function () { fit(true); }, stage: stage };
    fit(true);
    setTimeout(function () { fit(true); }, 700);   // 게임 초기 화면이 늦게 그려지는 경우
    setInterval(function () { if (!document.hidden) fit(false); }, 1500);   // 놓친 화면 전환 보정
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
