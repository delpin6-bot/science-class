/* 수업 게임 서랍 · 효과음과 배경음악
   - 정답: Victory_Lap.mp3 2초 + 축하 메시지
   - 오답: Prompt_Attention.mp3 2초 + 노력 메시지
   - 배경음악: Another_Try_At_Morning.mp3 반복 재생 (첫 클릭 뒤 시작)
*/
(function(){
  var BASE = "./sounds/";
  var SFX_MS = 2000;
  var BGM_VOL = 0.22, BGM_DUCK = 0.06, SFX_VOL = 0.9;
  var LS = "kjs-sound-v1";

  var OK_MSGS = ["정답! 멋져요 🎉", "훌륭해요! 👏", "완벽해요! ⭐", "대단해요! 🎊",
                 "바로 그거예요! 🙌", "최고예요! 🏆"];
  var NO_MSGS = ["괜찮아요, 다시 도전! 💪", "한 번 더 생각해 봐요 🤔", "거의 다 왔어요! 🔥",
                 "실수는 배움의 시작이에요 🌱", "포기하지 말아요, 힘내요! ✨", "천천히 다시 해 봐요 🙂"];

  var cfg = { bgm: true, sfx: true };
  try { var saved = JSON.parse(localStorage.getItem(LS) || "{}");
        if (typeof saved.bgm === "boolean") cfg.bgm = saved.bgm;
        if (typeof saved.sfx === "boolean") cfg.sfx = saved.sfx; } catch(e) {}
  function save(){ try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch(e) {} }

  function mk(src, loop, vol){
    var a = new Audio(BASE + src);
    a.preload = "auto"; a.loop = !!loop; a.volume = vol;
    return a;
  }
  var bgm = mk("Another_Try_At_Morning.mp3", true, BGM_VOL);
  var sOk = mk("Victory_Lap.mp3", false, SFX_VOL);
  var sNo = mk("Prompt_Attention.mp3", false, SFX_VOL);
  var sWin = mk("Top_of_the_Board.mp3", false, SFX_VOL);   /* 큰 축하: 게임 완료·1위·우승 */
  var stopTimer = null, fadeTimer = null, started = false;

  /* 웹(https) 접속 + 아이폰·아이패드: Web Audio로 재생해야 배경음악 음량이 조절됨 */
  var WA = (/^https?:/.test(location.protocol) && (window.AudioContext || window.webkitAudioContext) && window.fetch)
    ? { ctx: null, bufs: {}, gB: null, src: null, sfx: null, loading: null } : null;
  var WA_FILES = { ok: "Victory_Lap.mp3", no: "Prompt_Attention.mp3", win: "Top_of_the_Board.mp3", bgm: "Another_Try_At_Morning.mp3" };
  function waInit(){
    if (!WA) return null;
    if (!WA.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      WA.ctx = new AC();
      WA.gB = WA.ctx.createGain(); WA.gB.gain.value = BGM_VOL; WA.gB.connect(WA.ctx.destination);
      WA.loading = Promise.all(Object.keys(WA_FILES).map(function(k){
        return fetch(BASE + WA_FILES[k]).then(function(r){ return r.arrayBuffer(); }).then(function(ab){
          return new Promise(function(res){ WA.ctx.decodeAudioData(ab, function(b){ WA.bufs[k] = b; res(); }, function(){ res(); }); });
        }).catch(function(){});
      }));
    }
    if (WA.ctx.state === "suspended" && WA.ctx.resume) WA.ctx.resume();
    return WA.loading;
  }
  function waKey(a){ return a === sOk ? "ok" : a === sNo ? "no" : a === sWin ? "win" : null; }

  function startBgm(){
    if (!cfg.bgm) return;
    if (WA) {
      started = true;
      var ld = waInit();
      if (ld) ld.then(function(){
        if (!cfg.bgm || WA.src || !WA.bufs.bgm) return;
        WA.src = WA.ctx.createBufferSource(); WA.src.buffer = WA.bufs.bgm; WA.src.loop = true;
        WA.src.connect(WA.gB); WA.src.start(0);
      });
      return;
    }
    var p = bgm.play();
    if (p && p.catch) p.catch(function(){});
    started = true;
  }
  function stopBgm(){
    if (WA) { if (WA.src) { try { WA.src.stop(); } catch(e) {} WA.src = null; } return; }
    bgm.pause();
  }

  function playSfx(a, ms){
    if (!cfg.sfx) return;
    var dur = ms || SFX_MS;
    var k = waKey(a);
    if (WA && WA.ctx && k && WA.bufs[k]) {
      var c = WA.ctx, t0 = c.currentTime, end = t0 + dur / 1000;
      if (WA.sfx) { try { WA.sfx.stop(); } catch(e) {} }
      var g = c.createGain(); g.gain.setValueAtTime(SFX_VOL, t0); g.gain.setValueAtTime(SFX_VOL, Math.max(t0, end - 0.3)); g.gain.linearRampToValueAtTime(0.0001, end);
      g.connect(c.destination);
      var s = c.createBufferSource(); s.buffer = WA.bufs[k]; s.connect(g); s.start(0); s.stop(end + 0.05); WA.sfx = s;
      if (WA.src) { WA.gB.gain.cancelScheduledValues(t0); WA.gB.gain.setValueAtTime(BGM_DUCK, t0); WA.gB.gain.setValueAtTime(BGM_DUCK, end); WA.gB.gain.linearRampToValueAtTime(BGM_VOL, end + 0.4); }
      return;
    }
    if (WA) waInit();
    [sOk, sNo, sWin].forEach(function(x){ if (x !== a) { x.pause(); } });
    clearTimeout(stopTimer); clearInterval(fadeTimer);
    try { a.currentTime = 0; } catch(e) {}
    a.volume = SFX_VOL;
    if (cfg.bgm && !bgm.paused) bgm.volume = BGM_DUCK;
    var p = a.play(); if (p && p.catch) p.catch(function(){});
    stopTimer = setTimeout(function(){
      var v = SFX_VOL;
      fadeTimer = setInterval(function(){
        v -= 0.15;
        if (v <= 0) { clearInterval(fadeTimer); a.pause(); a.volume = SFX_VOL; bgm.volume = BGM_VOL; }
        else a.volume = v;
      }, 40);
    }, dur - 250);
  }

  /* 메시지 */
  var toast = null, toastTimer = null;
  function ensureToast(){
    if (toast) return toast;
    toast = document.createElement("div");
    toast.id = "kjsToast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
    return toast;
  }
  function show(msg, kind){
    var t = ensureToast();
    t.textContent = msg;
    t.className = "on " + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.className = kind; }, 1800);
  }
  function pick(a){ return a[Math.floor(Math.random() * a.length)]; }

  document.addEventListener("visibilitychange", function(){
    if (!WA || !WA.ctx) return;
    if (document.hidden) { if (WA.ctx.suspend) WA.ctx.suspend(); } else if (WA.ctx.resume) WA.ctx.resume();
  });

  window.KJS = {
    ok: function(opt){
      opt = opt || {};
      playSfx(sOk);
      if (opt.toast !== false) show(opt.msg || pick(OK_MSGS), "ok");
    },
    win: function(opt){
      opt = opt || {};
      playSfx(sWin, opt.ms || 4500);
      if (opt.toast !== false) show(opt.msg || "🏆 최고예요! 끝까지 해냈어요!", "win");
    },
    no: function(opt){
      opt = opt || {};
      playSfx(sNo);
      if (opt.toast !== false) show(opt.msg || pick(NO_MSGS), "no");
    },
    setBgm: function(on){ cfg.bgm = on; save(); if (on) startBgm(); else stopBgm(); paint(); },
    setSfx: function(on){ cfg.sfx = on; save(); paint(); }
  };

  /* 첫 상호작용 때 배경음악 시작 (브라우저 자동재생 정책) */
  function firstTouch(){
    if (!started) startBgm();
    document.removeEventListener("pointerdown", firstTouch, true);
    document.removeEventListener("keydown", firstTouch, true);
  }
  document.addEventListener("pointerdown", firstTouch, true);
  document.addEventListener("keydown", firstTouch, true);

  /* 상단 버튼 */
  var bBgm, bSfx;
  function paint(){
    if (bBgm) { bBgm.textContent = "🎵"; bBgm.title = cfg.bgm ? "배경음악 끄기" : "배경음악 켜기";
      bBgm.setAttribute("aria-label", bBgm.title); bBgm.setAttribute("aria-pressed", String(cfg.bgm)); }
    if (bSfx) { bSfx.textContent = cfg.sfx ? "🔔" : "🔕"; bSfx.title = cfg.sfx ? "효과음 끄기" : "효과음 켜기";
      bSfx.setAttribute("aria-label", bSfx.title); bSfx.setAttribute("aria-pressed", String(cfg.sfx)); }
  }
  function mountButtons(){
    if (document.getElementById("kjsBgm")) return;
    var uni = document.querySelector(".unified-nav-actions");
    if (uni) {                       /* 통일 링크 바: 모양을 바꾸지 않고 음악·효과음 버튼만 앞에 붙임 */
      bBgm = document.createElement("button"); bBgm.type = "button"; bBgm.id = "kjsBgm";
      bBgm.className = "btn-top btn-unified-nav";
      bBgm.onclick = function(e){ e.stopPropagation(); KJS.setBgm(!cfg.bgm); };
      bSfx = document.createElement("button"); bSfx.type = "button"; bSfx.id = "kjsSfx";
      bSfx.className = "btn-top btn-unified-nav";
      bSfx.onclick = function(e){ e.stopPropagation(); KJS.setSfx(!cfg.sfx); };
      uni.insertBefore(bSfx, uni.firstChild);
      uni.insertBefore(bBgm, uni.firstChild);
      paint(); return;
    }
    var nav = document.getElementById("kjsNav");
    if (!nav) return;
    bBgm = document.createElement("button"); bBgm.type = "button"; bBgm.id = "kjsBgm";
    bBgm.onclick = function(e){ e.stopPropagation(); KJS.setBgm(!cfg.bgm); };
    bSfx = document.createElement("button"); bSfx.type = "button"; bSfx.id = "kjsSfx";
    bSfx.onclick = function(e){ e.stopPropagation(); KJS.setSfx(!cfg.sfx); };
    nav.insertBefore(bSfx, nav.firstChild);
    nav.insertBefore(bBgm, nav.firstChild);
    var h = document.getElementById("kjsHome"); if (h) { h.textContent = "↺"; h.setAttribute("aria-label", "처음 화면"); }
    var a = nav.querySelector("a"); if (a) { a.textContent = "🗂"; a.setAttribute("aria-label", "수업 게임 서랍"); }
    nav.classList.add("compact");
    paint();
  }

  var css = document.createElement("style");
  css.textContent =
    "#kjsToast{position:fixed;left:50%;top:18%;transform:translate(-50%,-10px) scale(.96);z-index:100000;" +
    "padding:14px 26px;border-radius:999px;font:800 22px/1.2 'Malgun Gothic','맑은 고딕',system-ui,sans-serif;" +
    "color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.25);opacity:0;pointer-events:none;" +
    "transition:opacity .2s, transform .2s;white-space:nowrap}" +
    "#kjsToast.on{opacity:1;transform:translate(-50%,0) scale(1)}" +
    "#kjsToast.ok{background:linear-gradient(135deg,#0ca678,#37b24d)}" +
    "#kjsToast.no{background:linear-gradient(135deg,#f08c00,#e8590c)}" +
    "#kjsToast.win{background:linear-gradient(135deg,#7048e8,#e8590c);font-size:24px;padding:16px 30px}" +
    "#kjsNav button[aria-pressed='false']{opacity:.55}" +
    "#kjsNav.compact{gap:4px!important;top:calc(8px + env(safe-area-inset-top,0px))!important;right:8px!important}" +
    "#kjsNav.compact button,#kjsNav.compact a{width:34px;height:34px;padding:0!important;display:inline-flex;" +
    "align-items:center;justify-content:center;font-size:16px!important}" +
    "@media (max-width:600px){#kjsToast{font-size:17px;padding:11px 18px}}" +
    "@media print{#kjsToast{display:none!important}}" +
    "@media (prefers-reduced-motion: reduce){#kjsToast{transition:none}}";
  document.head.appendChild(css);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountButtons);
  else mountButtons();
})();
