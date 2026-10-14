(function () {
  "use strict";
  var LOG_KEY = "ql_bot_logs_v1", LOG_MAX = 8, logPage = 0;
  var navWired = false;

  function $(id) { return document.getElementById(id); }

  function loadLogs() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function saveLogs(a) {
    localStorage.setItem(LOG_KEY, JSON.stringify(a.slice(0, LOG_MAX * 4)));
  }
  function renderLogs() {
    var list = $("am-logs-list"), pageEl = $("am-logs-page");
    if (!list) return;
    var arr = loadLogs();
    var pages = Math.max(1, Math.ceil(arr.length / LOG_MAX) || 1);
    if (logPage >= pages) logPage = pages - 1;
    if (logPage < 0) logPage = 0;
    var slice = arr.slice(logPage * LOG_MAX, logPage * LOG_MAX + LOG_MAX);
    list.replaceChildren();
    if (!slice.length) {
      var e = document.createElement("div");
      e.className = "am-logs-empty";
      e.textContent = "No logs yet";
      list.appendChild(e);
    } else {
      slice.forEach(function (row) {
        var el = document.createElement("div");
        el.className = "am-logs-item";
        var t = document.createElement("div");
        t.className = "t";
        t.textContent = new Date(row.t).toLocaleString();
        var m = document.createElement("div");
        m.className = "m";
        m.textContent = row.m;
        el.appendChild(t);
        el.appendChild(m);
        list.appendChild(el);
      });
    }
    if (pageEl) pageEl.textContent = (logPage + 1) + " / " + pages;
    var bell = $("am-bell");
    if (bell) bell.classList.toggle("has-alert", arr.length > 0);
  }

  function setVal(id, text, on) {
    var el = $(id);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("is-on", !!on);
  }

  function paintShellStatus() {
    var ov = window.state && window.state.overview;
    if (!ov) return;
    function groupOn(key) {
      try {
        var groups = (ov.featureToggles && ov.featureToggles.groups) || [];
        var g = groups.find(function (x) { return x.key === key; });
        return !g || g.enabled !== false;
      } catch (e) { return true; }
    }
    var calOn = !!(ov.econcal && ov.econcal.enabled);
    if (!calOn) calOn = groupOn("econ_calendar");
    var newsOn = !!(ov.newsfeed && ov.newsfeed.enabled);
    if (!newsOn) newsOn = groupOn("newsfeed");
    var lvlOn = groupOn("leveling");
    if (ov.leveling && ov.leveling.enabled === false) lvlOn = false;
    if (ov.leveling && ov.leveling.enabled === true) lvlOn = true;
    var whopOn = !!(ov.whop && ov.whop.enabled);
    if (!whopOn) whopOn = groupOn("whop");
    setVal("st-calendar", calOn ? "On" : "Off", calOn);
    setVal("st-newsfeed", newsOn ? "On" : "Off", newsOn);
    setVal("st-leveling", lvlOn ? "On" : "Off", lvlOn);
    setVal("st-whop", whopOn ? "On" : "Off", whopOn);
  }

  function closeFloaters() {
    document.querySelectorAll("body > .cselect-menu, .cselect-menu.is-open, .cselect-menu:not([hidden])").forEach(function (m) {
      m.hidden = true;
      m.classList.remove("is-open");
      m.classList.add("is-leaving");
      try { m.replaceChildren(); } catch (e) {}
    });
    document.querySelectorAll('.cselect[data-open="1"]').forEach(function (w) {
      w.dataset.open = "";
      var b = w.querySelector(".cselect-trigger");
      if (b) b.setAttribute("aria-expanded", "false");
    });
  }

  function closeNav() {
    var s = document.querySelector(".app-shell");
    var b = document.getElementById("am-menu-btn");
    var c = document.getElementById("am-nav-scrim");
    if (s) s.classList.remove("nav-open");
    if (b) b.setAttribute("aria-expanded", "false");
    if (c) { c.hidden = true; }
  }
  function openNav() {
    var s = document.querySelector(".app-shell");
    var b = document.getElementById("am-menu-btn");
    var c = document.getElementById("am-nav-scrim");
    if (s) s.classList.add("nav-open");
    if (b) b.setAttribute("aria-expanded", "true");
    if (c) { c.hidden = false; }
  }

  function ensureSectionTitles() {
    var map = {
      overview: "Overview", composer: "Composer", appearance: "Appearance", studio: "Studio",
      leveling: "Leveling", giveaways: "Giveaways", feeds: "Feeds", automation: "Automation",
      tickets: "Tickets", moderation: "Moderation", settings: "Settings", owner: "Owner"
    };
    var sec = "";
    try { if (window.root && window.root.dataset) sec = window.root.dataset.section || ""; } catch (e) {}
    if (!sec) {
      var cur = document.querySelector(".sidebar-nav button[aria-current=\"true\"], #sections button[aria-current=\"true\"]");
      if (cur && cur.dataset) sec = cur.dataset.goto || "";
    }
    var label = map[sec] || "";
    var here = $("here");
    if (here && label) here.textContent = label;
  }

  function injectFixCss() {
    if (document.getElementById("shell-am-fix-style")) return;
    var s = document.createElement("style");
    s.id = "shell-am-fix-style";
    s.textContent = [
      ".workspace{margin:12px 12px 12px 0!important;background:#0e0e0e!important;border:1px solid #1a1a1a!important;border-radius:16px!important;box-shadow:none!important}",
      ".workspace-body{padding:0 20px 24px!important;background:transparent!important}",
      ".workspace-body > .section{display:none!important;min-height:0!important}",
      ".workspace-body > .section[data-active]{display:flex!important;flex-direction:column!important;gap:1.1rem!important;flex:0 0 auto!important;min-height:0!important;width:100%!important;align-content:flex-start!important}",
      ".content-toolbar{background:#0e0e0e!important;border-bottom:1px solid #161616!important;margin:0 0 12px!important}",
      ".workspace-section-label,.content-toolbar h1,#here{font-size:16px!important;font-weight:500!important;color:#e9e9e9!important;margin:0!important;display:block!important;visibility:visible!important;opacity:1!important;min-height:1.2em!important}",
      ".composer{display:grid!important;grid-template-columns:minmax(180px,15.5rem) minmax(0,1fr)!important;gap:1rem!important;align-items:start!important;width:100%!important}",
      ".tpl-list,.composer-body,#composer-body,#appearance-body{min-height:0!important}",
      "#appearance-body,#composer-body{align-self:start!important}",
      "@media (max-width:52rem){.composer{grid-template-columns:1fr!important}}",
      ".lvl-stat-row{display:flex!important;flex-wrap:wrap!important;gap:1rem 1.5rem!important;align-items:center!important;justify-content:flex-start!important;width:100%!important}",
      ".lvl-edit-meta{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;flex-wrap:wrap!important;width:100%!important;padding-top:10px!important;border-top:1px solid #161616!important;margin-top:2px!important}",
      "@media (max-width:900px){.workspace{margin:0!important;border-radius:0!important;border:none!important}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  function wireNav() {
    if (navWired) return;
    navWired = true;
    document.querySelectorAll("#sections button[data-goto], .sidebar-nav button[data-goto]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        closeFloaters();
        closeNav();
        setTimeout(ensureSectionTitles, 0);
        setTimeout(ensureSectionTitles, 50);
      });
    });
    var menu = $("am-menu-btn");
    var scrim = $("am-nav-scrim");
    if (menu) {
      menu.addEventListener("click", function (e) {
        e.stopPropagation();
        var s = document.querySelector(".app-shell");
        if (s && s.classList.contains("nav-open")) closeNav();
        else openNav();
      });
    }
    if (scrim) scrim.addEventListener("click", function () { closeNav(); });
    var bell = $("am-bell"), logs = $("am-logs");
    if (bell && logs) {
      bell.addEventListener("click", function (e) {
        e.stopPropagation();
        logs.hidden = !logs.hidden;
        if (!logs.hidden) renderLogs();
      });
    }
    var logsClear = $("am-logs-clear");
    if (logsClear) logsClear.addEventListener("click", function () { saveLogs([]); logPage = 0; renderLogs(); });
    var logsPrev = $("am-logs-prev"), logsNext = $("am-logs-next");
    if (logsPrev) logsPrev.addEventListener("click", function () { logPage--; renderLogs(); });
    if (logsNext) logsNext.addEventListener("click", function () { logPage++; renderLogs(); });
  }

  function patchSectionNames() {
    try {
      var obs = new MutationObserver(function () { ensureSectionTitles(); });
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-section"] });
      var main = document.getElementById("main");
      if (main) obs.observe(main, { attributes: true, attributeFilter: ["data-section"] });
      document.querySelectorAll(".sidebar-nav button[data-goto]").forEach(function (b) {
        obs.observe(b, { attributes: true, attributeFilter: ["aria-current"] });
      });
    } catch (e) {}
  }

  function patchOwnerSafety() {
    try {
      if (typeof window.el === "function" && !window.el.__amPatched) {
        var _el = window.el;
        window.el = function (tag, cls, text) {
          var node = _el(tag, cls, text);
          if (text && typeof text === "object" && text.nodeType) {
            try {
              if (node && node.firstChild && node.firstChild.nodeType === 3) node.replaceChildren();
              node.appendChild(text);
            } catch (e) {}
          }
          return node;
        };
        window.el.__amPatched = true;
      }
    } catch (e) {}
  }

  function boot() {
    injectFixCss();
    wireNav();
    patchSectionNames();
    patchOwnerSafety();
    ensureSectionTitles();
    paintShellStatus();
    renderLogs();
    setInterval(paintShellStatus, 2500);
    setInterval(ensureSectionTitles, 1500);
  }

  window.__paintShellStatus = paintShellStatus;
  window.__closeFloaters = closeFloaters;
  window.__ensureSectionTitles = ensureSectionTitles;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
