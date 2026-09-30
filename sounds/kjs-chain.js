/* 차시 연속 수업 — 마인드맵 → 개념격추 → 개념수비대 → 골든벨을 같은 차시로 이어서 진행
   · 수업 코스 화면(수업코스_차시연속진행.html)에서 차시를 고르면 각 게임이 그 차시로 바로 열린다.
   · 주소에 lc=차시번호(L001…)가 있으면 게임 머리글 아래에 [① ② ③ ④ · 다음 ▶] 띠가 나타난다.
   · 4개 게임의 차시·개념·문제는 수업데이터/차시통합데이터.json 하나에서 만들어져 서로 같다. */
(function () {
  "use strict";
  if (window.__kjsChain) return; window.__kjsChain = 1;
  var LS = window.KJS_LESSONS || [];
  var STEPS = [
    { k: "mm",  f: "마인드맵.html",   ic: "🧠", nm: "마인드맵",   min: 8,  d: "개념을 가지에 붙여 구조 정리" },
    { k: "gk",  f: "개념격추.html",   ic: "🎯", nm: "개념격추",   min: 8,  d: "설명에 맞는 개념을 빠르게 인출" },
    { k: "inv", f: "개념수비대.html", ic: "🛡️", nm: "개념수비대", min: 8,  d: "개념을 판별하며 반복 인출" },
    { k: "gb",  f: "골든벨.html",     ic: "🔔", nm: "골든벨",     min: 15, d: "20문제 형성평가 · 오답 피드백" }
  ];
  function hcode(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
  function find(id) { for (var i = 0; i < LS.length; i++) if (LS[i][0] === id) return LS[i]; return null; }
  /* 각 게임이 쓰는 차시 코드(QR 딥링크와 같은 방식) */
  function url(step, L) {
    var title = L[4] + " · " + L[5];
    var q = step.k === "mm" ? hcode([L[1], L[2], title].join("|")) : hcode([L[1], L[2], L[3], title].join("|"));
    return "./" + step.f + "?q=" + q + "&lc=" + L[0];
  }
  window.KJSChain = { steps: STEPS, lessons: LS, find: find, url: url, hcode: hcode };

  var lc = new URLSearchParams(location.search).get("lc"), L = lc && find(lc);
  var file = ""; try { file = decodeURIComponent(location.pathname.split("/").pop()); } catch (e) {}
  var cur = -1; STEPS.forEach(function (s, i) { if (s.f === file) cur = i; });
  if (!L || cur < 0) return;

  var css = ".kc-bar{box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 10px;margin:6px auto;padding:6px 12px;max-width:1240px;width:calc(100% - 16px);background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:12px;font:700 13px/1.25 -apple-system,'Malgun Gothic',sans-serif;color:#4c1d95;position:relative;z-index:50}" +
    ".kc-t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46ch}.kc-t b{color:#5b21b6}" +
    ".kc-s{display:flex;gap:4px;flex-wrap:wrap;justify-content:center}" +
    ".kc-s a{padding:5px 10px;border-radius:999px;border:1px solid #ddd6fe;background:#fff;color:#6d28d9;text-decoration:none;white-space:nowrap}" +
    ".kc-s a.done{background:#ede9fe;color:#7c3aed}.kc-s a.on{background:#7c3aed;border-color:#7c3aed;color:#fff}" +
    ".kc-n{padding:7px 14px;border-radius:10px;background:#f59e0b;color:#1f2937!important;text-decoration:none;font-weight:800;white-space:nowrap}" +
    ".kc-x{color:#6d28d9;text-decoration:none;font-weight:700;white-space:nowrap}" +
    "@media (max-width:640px){.kc-bar{gap:6px;padding:6px 8px}.kc-t{display:none}.kc-s{flex-wrap:nowrap;gap:3px}.kc-s a{padding:5px 7px}.kc-s a:not(.on) .n{display:none}.kc-n{padding:7px 10px;font-size:12.5px}.kc-x{display:none}}" +
    "@media print{.kc-bar{display:none!important}}";
  function build() {
    if (document.querySelector(".kc-bar")) return;
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    var bar = document.createElement("div"); bar.className = "kc-bar"; bar.setAttribute("role", "navigation"); bar.setAttribute("aria-label", "차시 연속 수업");
    var h = '<div class="kc-t">📚 <b>' + L[5] + '</b> · ' + L[4] + '</div><div class="kc-s">';
    STEPS.forEach(function (s, i) {
      h += '<a class="' + (i < cur ? "done" : i === cur ? "on" : "") + '" href="' + url(s, L) + '" title="' + s.d + '">' + (i < cur ? "✓ " : (i + 1) + " ") + s.ic + '<span class="n"> ' + s.nm + "</span></a>";
    });
    h += "</div>";
    if (cur < STEPS.length - 1) h += '<a class="kc-n" href="' + url(STEPS[cur + 1], L) + '">다음: ' + STEPS[cur + 1].ic + " " + STEPS[cur + 1].nm + " ▶</a>";
    else h += '<a class="kc-n" href="./교사대시보드.html">🏁 코스 완료 · 오답 대시보드 ▶</a>';
    h += '<a class="kc-x" href="./수업코스_차시연속진행.html?lc=' + L[0] + '">코스 화면</a>';
    bar.innerHTML = h;
    var hd = document.querySelector("header"); 
    if (hd && hd.parentNode) hd.parentNode.insertBefore(bar, hd.nextSibling); else document.body.insertBefore(bar, document.body.firstChild);
    try { window.dispatchEvent(new Event("resize")); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(build, 60); }); else setTimeout(build, 60);
})();
