/* 공통 머리글 정렬 — 서랍 머리글과 같은 3칸 구조로 통일
   [왼쪽: 제목·브랜드] · [가운데: 서랍 전환 탭(.kjs-seg)] · [오른쪽: 버튼 묶음(.unified-nav-actions)]
   - 가로 막대형 머리글: 머리글 자체를 3칸 격자로 바꾼다.
   - 세로 쌓기형 머리글(제목·점수판이 위아래로 쌓인 게임 화면): 맨 위에 [ · 전환 탭 · 버튼] 한 줄을 만든다.
   화면마다 코드를 고치지 않고 이 파일 하나로 처리한다. */
(function () {
  "use strict";
  if (window.__kjsTopbar) return; window.__kjsTopbar = 1;

  // 페이지 자체 스타일(예: header.unified-game-header{display:flex})보다 우선하도록 선택자 우선순위를 높인다
  var P = "html body .kjs-topbar.kjs-topbar";
  var CSS = [
    P + "{display:grid!important;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)!important;align-items:center!important;column-gap:14px;row-gap:8px;flex-wrap:nowrap}",
    P + ">.kjs-top-l{grid-column:1;grid-row:1;justify-self:start;display:flex;align-items:center;gap:12px;min-width:0;flex-wrap:wrap}",
    P + ">.kjs-seg{grid-column:2;grid-row:1;justify-self:center;margin:0!important}",
    P + ">.kjs-top-r{grid-column:3;grid-row:1;justify-self:end;min-width:0;display:flex!important;align-items:center;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin:0!important;width:auto!important;flex:none!important}",
    P + ".kjs-toprow{width:100%;margin:0 0 10px;box-sizing:border-box;flex:0 0 100%;order:-1;grid-column:1 / -1}",
    "@media (max-width:760px){",
    "  " + P + "{grid-template-columns:minmax(0,1fr) auto!important}",
    "  " + P + ">.kjs-top-r{grid-column:2}",
    "  " + P + ">.kjs-seg{grid-column:1 / -1;grid-row:2}",
    "}",
    "@media print{.kjs-toprow{display:none!important}}"
  ].join("\n");

  function run() {
    var seg = document.querySelector(".kjs-seg");
    if (!seg || seg.closest(".kjs-topbar")) return;
    var actions = seg.parentElement;
    var hdr = actions && actions.parentElement;
    if (!actions || !hdr) return;

    var st = document.createElement("style"); st.id = "kjs-topbar-style"; st.textContent = CSS;
    document.head.appendChild(st);

    // 머리글 모양 판별: 버튼 묶음이 첫 요소와 같은 줄에 있으면 가로 막대형
    var kids = Array.prototype.filter.call(hdr.children, function (c) {
      return c !== actions && !/^(SCRIPT|STYLE|TITLE|LINK|META)$/.test(c.tagName);
    });
    var bar = false;
    if (hdr !== document.body && kids.length) {
      var a = actions.getBoundingClientRect(), f = kids[0].getBoundingClientRect();
      bar = Math.abs((a.top + a.height / 2) - (f.top + f.height / 2)) < 26 && a.left > f.left;
    }

    actions.classList.add("kjs-top-r");
    if (bar) {
      // 가로 막대형: [제목 묶음] [전환 탭] [버튼 묶음]
      var left = document.createElement("div"); left.className = "kjs-top-l";
      hdr.insertBefore(left, kids[0]);
      kids.forEach(function (k) { left.appendChild(k); });
      hdr.insertBefore(seg, actions);
      hdr.classList.add("kjs-topbar");
      // 좌우 여백이 다르면(예전 떠 있는 버튼 자리) 가운데가 어긋나므로 같게 맞춘다
      var hs = getComputedStyle(hdr), pl = parseFloat(hs.paddingLeft) || 0, pr = parseFloat(hs.paddingRight) || 0;
      if (Math.abs(pl - pr) > 4) { var p = Math.min(pl, pr); hdr.style.paddingLeft = p + "px"; hdr.style.paddingRight = p + "px"; }
    } else {
      // 세로 쌓기형 또는 본문 도구줄: 맨 위에 새 한 줄 [ · 전환 탭 · 버튼]
      var row = document.createElement("div"); row.className = "kjs-topbar kjs-toprow";
      var l = document.createElement("div"); l.className = "kjs-top-l";
      row.appendChild(l); row.appendChild(seg);
      var host = hdr === document.body ? actions : hdr;
      if (hdr === document.body) {
        // 본문 바로 아래 도구줄(예: AI 학습지): 도구줄 앞에 새 줄을 두고 도구 버튼은 제자리
        actions.classList.remove("kjs-top-r");
        host.parentNode.insertBefore(row, host);
      } else {
        row.appendChild(actions);
        hdr.insertBefore(row, hdr.firstChild);
        // 가로 줄 세우기 머리글이면 새 줄이 한 줄 전체를 차지하도록 줄바꿈 허용
        var hcs = getComputedStyle(hdr);
        if (/flex/.test(hcs.display) && !/column/.test(hcs.flexDirection)) hdr.style.flexWrap = "wrap";
        // 예전 떠 있던 버튼 자리로 남은 한쪽 여백을 없애 새 줄이 가운데 오게
        var ql = parseFloat(hcs.paddingLeft) || 0, qr = parseFloat(hcs.paddingRight) || 0;
        if (Math.abs(ql - qr) > 4) { var q = Math.min(ql, qr); hdr.style.paddingLeft = q + "px"; hdr.style.paddingRight = q + "px"; }
      }
    }
    // 새 줄(맨 위 메뉴 줄)은 좁은 게임 틀 안에 있어도 서랍 머리글처럼 화면 전체 폭을 쓴다
    var topRow = document.querySelector(".kjs-toprow");
    if (topRow && hdr !== document.body) {
      var fit = function () {
        topRow.style.width = ""; topRow.style.marginLeft = ""; topRow.style.flex = "";
        var pr = topRow.parentElement.getBoundingClientRect(), vw = document.documentElement.clientWidth;
        if (Math.abs((pr.left + pr.right) / 2 - vw / 2) > 6) return;          // 틀이 가운데에 있을 때만
        var left = topRow.getBoundingClientRect().left, side = Math.min(20, left);
        topRow.style.flex = "0 0 auto";
        topRow.style.width = (vw - 2 * side) + "px";
        topRow.style.marginLeft = (side - left) + "px";
      };
      fit(); window.addEventListener("resize", fit);
    }
    // 고정(fixed) 머리글은 높이가 바뀌면 본문을 가릴 수 있으므로 본문 여백을 맞춘다
    var cs = getComputedStyle(hdr);
    if (cs.position === "fixed") {
      var h = hdr.getBoundingClientRect().height, pt = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
      if (h > pt) document.body.style.paddingTop = Math.ceil(h + 8) + "px";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
