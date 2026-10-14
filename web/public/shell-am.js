(function () {
  "use strict";
  var navWired = false;
  function $(id) { return document.getElementById(id); }
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
      var cur = document.querySelector('.sidebar-nav button[aria-current="true"], #sections button[aria-current="true"]');
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
      ".sidebar{border-right:none!important;box-shadow:none!important}",
      ".workspace{margin:10px 12px 12px 4px!important;background:#0e0e0e!important;border:1px solid #1a1a1a!important;border-radius:16px!important;box-shadow:none!important}",
      ".workspace-body{padding:0 20px 28px!important;background:transparent!important}",
      ".workspace-body > .section{display:none!important;min-height:0!important}",
      ".workspace-body > .section[data-active]{display:flex!important;flex-direction:column!important;gap:12px!important;flex:0 0 auto!important;min-height:0!important;width:100%!important;align-content:flex-start!important}",
      ".section .grid{gap:12px!important}",
      ".panel,.card,.stat-card,.tile,.gaw,.lvl-lb-panel{margin-bottom:0!important}",
      ".grid > .panel,.grid > .card{margin:0!important}",
      ".board{gap:12px!important}",
      ".content-toolbar{background:#0e0e0e!important;border-bottom:1px solid #161616!important;margin:0 0 12px!important}",
      ".workspace-section-label,.content-toolbar h1,#here{font-size:16px!important;font-weight:500!important;color:#e9e9e9!important;margin:0!important;display:block!important;visibility:visible!important;opacity:1!important;min-height:1.2em!important}",
      "#am-bell,#am-logs,.am-logs,.am-icon-btn#am-bell{display:none!important;visibility:hidden!important;height:0!important;width:0!important;overflow:hidden!important;pointer-events:none!important}",
      ".composer{display:grid!important;grid-template-columns:minmax(180px,15.5rem) minmax(0,1fr)!important;gap:0.9rem!important;align-items:start!important;width:100%!important}",
      ".tpl-list,.composer-body,#composer-body,#appearance-body{min-height:0!important}",
      "#appearance-body,#composer-body{align-self:start!important}",
      "@media (max-width:52rem){.composer{grid-template-columns:1fr!important}}",
      ".panel.lvl-hero,.lvl-lb-panel,.panel{margin:0!important}",
      ".workspace-body > .section[data-active] > .panel + .panel,.workspace-body > .section[data-active] > .panel + .grid,.workspace-body > .section[data-active] > .grid + .panel{margin-top:0!important}",
      ".lvl-hero-top{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;flex-wrap:wrap!important;width:100%!important;margin-bottom:4px!important}",
      ".lvl-hero-top h2{margin:0!important;font-size:0.92rem!important;font-weight:600!important;letter-spacing:0.08em!important;text-transform:uppercase!important;color:#c8c8c8!important}",
      ".lvl-hero-top .pill,.lvl-hero-top .pill.on{display:inline-flex!important;align-items:center!important;padding:4px 12px!important;border-radius:999px!important;border:1px solid #2a4a3a!important;background:transparent!important;color:#3dd68c!important;font-size:0.72rem!important;font-weight:600!important;letter-spacing:0.04em!important}",
      ".lvl-stat-row{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:10px!important;width:100%!important;margin-top:14px!important}",
      ".lvl-chip{display:flex!important;flex-direction:column!important;justify-content:center!important;gap:4px!important;padding:14px 12px!important;min-height:4.25rem!important;background:#111!important;border:1px solid #1f1f1f!important;border-radius:12px!important;box-sizing:border-box!important}",
      ".lvl-chip strong{font-size:1.1rem!important;font-weight:600!important;color:#e9e9e9!important;font-variant-numeric:tabular-nums!important;line-height:1.2!important}",
      ".lvl-chip span{font-size:0.68rem!important;font-weight:500!important;letter-spacing:0.05em!important;text-transform:uppercase!important;color:#6a6a6a!important}",
      "@media (max-width:720px){.lvl-stat-row{grid-template-columns:repeat(2,minmax(0,1fr))!important}}",
      ".lvl-split.grid{display:grid!important;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)!important;gap:12px!important;align-items:start!important}",
      ".lvl-edit-meta{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;flex-wrap:wrap!important;width:100%!important;padding-top:10px!important;border-top:1px solid #161616!important;margin-top:2px!important}",
      "@media (max-width:900px){.workspace{margin:0!important;border-radius:0!important;border:none!important}.sidebar{border-right:1px solid #222!important}.lvl-split.grid{grid-template-columns:1fr!important}}"
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
    setInterval(paintShellStatus, 2500);
    setInterval(ensureSectionTitles, 1500);
  }
  window.__paintShellStatus = paintShellStatus;
  window.__closeFloaters = closeFloaters;
  window.__ensureSectionTitles = ensureSectionTitles;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
