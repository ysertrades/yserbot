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

  /** Read real feature state from overview (same sources Overview cards use). */
  function paintShellStatus() {
    var ov = window.state && window.state.overview;
    if (!ov) return;

    function groupOn(key) {
      try {
        var groups = (ov.featureToggles && ov.featureToggles.groups) || [];
        var g = groups.find(function (x) { return x.key === key; });
        return !g || g.enabled !== false;
      } catch (e) {
        return true;
      }
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
      overview: "Overview",
      composer: "Composer",
      appearance: "Appearance",
      studio: "Studio",
      leveling: "Leveling",
      giveaways: "Giveaways",
      feeds: "Feeds",
      automation: "Automation",
      tickets: "Tickets",
      moderation: "Moderation",
      settings: "Settings",
      owner: "Owner"
    };
    var sec = "";
    try {
      if (window.root && window.root.dataset && window.root.dataset.section) sec = window.root.dataset.section;
    } catch (e) {}
    if (!sec) {
      var cur = document.querySelector(".sidebar-nav button[aria-current=\"true\"], #sections button[aria-current=\"true\"]");
      if (cur && cur.dataset && cur.dataset.goto) sec = cur.dataset.goto;
    }
    if (!sec) sec = document.documentElement.getAttribute("data-section") || "";
    var label = map[sec] || "";
    var here = $("here");
    if (here && label) here.textContent = label;
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
    if (scrim) {
      scrim.addEventListener("click", function () { closeNav(); });
    }
    var bell = $("am-bell");
    var logs = $("am-logs");
    var logsX = $("am-logs-close");
    var logsClear = $("am-logs-clear");
    var logsPrev = $("am-logs-prev");
    var logsNext = $("am-logs-next");
    if (bell && logs) {
      bell.addEventListener("click", function (e) {
        e.stopPropagation();
        logs.hidden = !logs.hidden;
        if (!logs.hidden) renderLogs();
      });
    }
    if (logsX && logs) logsX.addEventListener("click", function () { logs.hidden = true; });
    if (logsClear) logsClear.addEventListener("click", function () { saveLogs([]); logPage = 0; renderLogs(); });
    if (logsPrev) logsPrev.addEventListener("click", function () { logPage--; renderLogs(); });
    if (logsNext) logsNext.addEventListener("click", function () { logPage++; renderLogs(); });
  }

  function patchSectionNames() {
    var here = $("here");
    if (!here) return;
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
      if (typeof window.renderOwnerConsole === "function" && !window.renderOwnerConsole.__amPatched) {
        var _roc = window.renderOwnerConsole;
        window.renderOwnerConsole = function () {
          try {
            (window.state && window.state.ownerGuilds || []).forEach(function (g) {
              if (!g.staff) g.staff = [];
            });
          } catch (e) {}
          return _roc.apply(this, arguments);
        };
        window.renderOwnerConsole.__amPatched = true;
      }
    } catch (e) {}
  }

  function boot() {
    wireNav();
    patchSectionNames();
    patchOwnerSafety();
    ensureSectionTitles();
    paintShellStatus();
    renderLogs();
    setInterval(paintShellStatus, 2500);
    setInterval(ensureSectionTitles, 1500);
    var _patchN = 0;
    var _patchT = setInterval(function () {
      patchOwnerSafety();
      if (++_patchN > 60) clearInterval(_patchT);
    }, 500);
  }

  window.__paintShellStatus = paintShellStatus;
  window.__closeFloaters = closeFloaters;
  window.__ensureSectionTitles = ensureSectionTitles;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
