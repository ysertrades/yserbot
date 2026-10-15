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
      ".section[data-active],.section .panel,.section .grid > *,.tiles > *,.grid > *{animation:none!important}",
      ".workspace-body .section,.workspace-body .panel,.workspace-body .card{transform:none!important;filter:none!important}",
      ".sidebar-nav.sections>button,.sections.sidebar-nav>button,#sections button{transition:none!important}",
      ".sidebar-nav.sections>button .nav-ico-wrap,#sections button .nav-ico-wrap{transition:none!important}",
      ".workspace{margin:10px 12px 12px 4px!important;background:#0e0e0e!important;border:1px solid #1a1a1a!important;border-radius:16px!important;box-shadow:none!important}",
      ".workspace-body{padding:0 20px 28px!important;background:transparent!important}",
      ".workspace-body > .section{display:none!important;min-height:0!important}",
      ".workspace-body > .section[data-active]{display:flex!important;flex-direction:column!important;gap:14px!important;flex:0 0 auto!important;min-height:0!important;width:100%!important}",
      ".workspace-body .grid{gap:14px!important}",
      ".panel,.card,.stat-card,.tile,.gaw,.lvl-lb-panel{margin:0!important}",
      ".content-toolbar{background:#0e0e0e!important;border-bottom:1px solid #161616!important;margin:0 0 12px!important}",
      ".workspace-section-label,.content-toolbar h1,#here{font-size:16px!important;font-weight:500!important;color:#e9e9e9!important;margin:0!important;display:block!important;visibility:visible!important;opacity:1!important}",
      "#am-bell,#am-logs,.am-logs,.am-icon-btn#am-bell{display:none!important;visibility:hidden!important;height:0!important;width:0!important;overflow:hidden!important;pointer-events:none!important}",
      ".composer{display:grid!important;grid-template-columns:minmax(180px,15.5rem) minmax(0,1fr)!important;gap:14px!important;align-items:start!important;width:100%!important}",
      "@media (max-width:52rem){.composer{grid-template-columns:1fr!important}}",
      "#leveling-root,.lvl-root{display:flex!important;flex-direction:column!important;gap:14px!important;width:100%!important}",
      "#leveling-root > .panel:first-child,.lvl-stats-panel{display:flex!important;flex-direction:column!important;padding:12px!important;background:#0c0c0c!important;border:1px solid #1a1a1a!important;border-radius:16px!important;gap:0!important}",
      ".lvl-hero-top,#leveling-root > .panel:first-child > p.muted{display:none!important;height:0!important;margin:0!important;padding:0!important;overflow:hidden!important}",
      ".lvl-stat-row{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:10px!important;width:100%!important;margin:0!important}",
      ".lvl-chip{display:flex!important;flex-direction:column!important;justify-content:center!important;gap:6px!important;min-height:3.75rem!important;padding:14px!important;background:#111!important;border:1px solid #222!important;border-radius:12px!important;box-sizing:border-box!important}",
      ".lvl-chip strong{font-size:1.15rem!important;font-weight:600!important;color:#e9e9e9!important;font-variant-numeric:tabular-nums!important}",
      ".lvl-chip span{font-size:0.68rem!important;font-weight:500!important;letter-spacing:0.04em!important;text-transform:uppercase!important;color:#6a6a6a!important}",
      ".lvl-split.grid{display:grid!important;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)!important;gap:14px!important;align-items:start!important}",
      ".lvl-edit-meta{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;flex-wrap:wrap!important;width:100%!important;padding-top:10px!important;border-top:1px solid #161616!important}",
      "@media (max-width:720px){.lvl-stat-row{grid-template-columns:repeat(2,minmax(0,1fr))!important}.lvl-split.grid{grid-template-columns:1fr!important}}",
      ".section[data-section=overview] .grid{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:14px!important;align-items:stretch!important;width:100%!important}",
      "@media (max-width:46rem){.section[data-section=overview] .grid{grid-template-columns:1fr!important}}",
      ".section[data-section=overview] .grid > .panel{min-width:0!important;width:100%!important;height:100%!important;box-sizing:border-box!important;display:flex!important;flex-direction:column!important;padding:1.15rem 1.2rem 1.25rem!important}",
      ".section[data-section=overview] .grid > .panel > h2{margin:0 0 0.85rem!important;flex:none!important}",
      ".section[data-section=overview] .grid > .panel > .rows{flex:1 1 auto!important;display:flex!important;flex-direction:column!important;gap:0.7rem!important;justify-content:flex-start!important}",
      ".section[data-section=overview] .grid > .panel > .rows > .row{min-height:1.35rem!important;align-items:center!important}",
      "#card-health[hidden],#card-health[aria-hidden=true]{display:none!important}",
      ".section[data-section=overview] .grid > .panel:has(#card-health){display:none!important;height:0!important;margin:0!important;padding:0!important;border:0!important;overflow:hidden!important}",
      ".section[data-section=overview] .grid > .panel:has(#card-systems){order:1!important}",
      ".section[data-section=overview] .grid > .panel:has(#card-counts){order:2!important}",
      ".section[data-section=overview] .grid > .panel#panel-leaderboard{display:none!important;height:0!important;margin:0!important;padding:0!important;border:0!important;overflow:hidden!important;order:3!important}",
      ".section[data-section=overview] .grid > .panel.members-panel{order:4!important}",
      "@media (max-width:900px){.am-menu-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important}.app-shell{display:block!important;position:relative!important;height:100dvh!important;overflow:hidden!important;flex-direction:unset!important}.sidebar{position:fixed!important;left:0!important;top:0!important;bottom:0!important;width:min(288px,86vw)!important;max-width:min(288px,86vw)!important;min-width:0!important;flex:none!important;z-index:120!important;transform:translateX(-110%)!important;transition:transform .28s cubic-bezier(0.22,1,0.36,1)!important;display:flex!important;flex-direction:column!important;background:#121212!important;border-right:1px solid #222!important;border-bottom:none!important;box-shadow:8px 0 32px rgba(0,0,0,.45)!important;padding:16px 12px 12px!important;overflow-y:auto!important;overflow-x:hidden!important;box-sizing:border-box!important;height:100dvh!important;max-height:100dvh!important}.app-shell.nav-open .sidebar{transform:translateX(0)!important}.am-nav-scrim{position:fixed!important;inset:0!important;background:rgba(0,0,0,.55)!important;z-index:110!important;opacity:0!important;pointer-events:none!important;visibility:hidden!important;transition:opacity .22s ease,visibility .22s ease!important}.app-shell.nav-open .am-nav-scrim{opacity:1!important;pointer-events:auto!important;visibility:visible!important}.workspace{margin:0!important;width:100%!important;max-width:100%!important;height:100dvh!important;border-radius:0!important;border:none!important;display:flex!important;flex-direction:column!important;min-width:0!important}.workspace-body{padding:0 14px 28px!important;margin:0!important;overflow-y:auto!important;flex:1 1 auto!important;min-height:0!important;border:none!important;border-radius:0!important}.sidebar-nav.sections{flex:1 1 auto!important;flex-direction:column!important;justify-content:flex-start!important;align-content:flex-start!important;overflow-y:auto!important;overflow-x:hidden!important;min-height:0!important;gap:2px!important;width:100%!important}.sidebar-nav.sections>button{flex:0 0 auto!important;height:auto!important;min-height:44px!important;width:100%!important;max-width:100%!important;display:flex!important;align-items:center!important;white-space:normal!important;box-sizing:border-box!important}.sidebar-nav.sections>button[hidden],.sidebar-nav.sections>button[aria-hidden=true]{display:none!important;height:0!important;min-height:0!important;padding:0!important;margin:0!important;overflow:hidden!important}.sidebar-status{flex:none!important;margin-top:auto!important;width:100%!important}.sidebar-brand{flex:none!important;width:100%!important}.lvl-stat-row{grid-template-columns:repeat(2,minmax(0,1fr))!important}.lvl-split.grid{grid-template-columns:1fr!important}}"
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
