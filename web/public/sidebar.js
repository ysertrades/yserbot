/* The sidebar's collapse button (styles in sidebar.css).
   PC: the button in the brand row (or Ctrl/Cmd+B) folds the sidebar down to
   its icons and back, and the choice is remembered. While collapsed, the
   name of a hovered or focused icon shows beside it.
   Phone: the drawer is unchanged; the same button closes it. */
(function () {
  "use strict";
  var KEY = "qb.sidebar";
  var root = document.documentElement;
  var phone = window.matchMedia("(max-width: 900px)");
  var shortcut = /Mac|iPhone|iPad/.test(navigator.platform || "") ? "⌘B" : "Ctrl B";

  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function isRail() { return root.getAttribute("data-sb") === "rail"; }

  function paint() {
    var b = document.getElementById("sb-toggle");
    if (!b) return;
    var label = phone.matches ? "Close menu" : (isRail() ? "Expand sidebar" : "Collapse sidebar");
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-expanded", phone.matches ? "true" : String(!isRail()));
    b.title = phone.matches ? label : label + " (" + shortcut + ")";
  }
  function setRail(on) {
    root.setAttribute("data-sb", on ? "rail" : "open");
    save(on ? "rail" : "open");
    hideTip();
    paint();
  }

  var tip = null;
  function showTip(el) {
    if (!isRail() || phone.matches) return;
    var text = "", hint = "";
    if (el.id === "sb-toggle") { text = el.getAttribute("aria-label"); hint = shortcut; }
    else if (el.classList.contains("sidebar-status-row")) {
      var s = el.querySelector("span:not(.val)"), v = el.querySelector(".val");
      text = s ? s.textContent.trim() : ""; hint = v ? v.textContent.trim() : "";
    } else { var l = el.querySelector(".nav-label"); text = l ? l.textContent.trim() : ""; }
    if (!text) return;
    if (!tip) { tip = document.createElement("div"); tip.className = "sb-tip"; tip.setAttribute("aria-hidden", "true"); document.body.appendChild(tip); }
    tip.textContent = text;
    if (hint) { var sm = document.createElement("small"); sm.textContent = hint; tip.appendChild(sm); }
    var r = el.getBoundingClientRect();
    tip.style.left = Math.round(r.right + 12) + "px";
    tip.style.top = Math.round(r.top + r.height / 2) + "px";
    tip.classList.add("on");
  }
  function hideTip() { if (tip) tip.classList.remove("on"); }
  function target(e) { return e.target && e.target.closest ? e.target.closest(".sidebar-nav > button, #sb-toggle, .sidebar-status-row") : null; }

  function boot() {
    var side = document.querySelector(".app-shell .sidebar");
    var toggle = document.getElementById("sb-toggle");
    if (!side || !toggle) return;
    root.classList.add("sbx");
    root.setAttribute("data-sb", saved() === "rail" ? "rail" : "open");
    paint();
    // let the width animate only after the first state is painted
    setTimeout(function () { root.classList.add("sb-ready"); }, 120);

    toggle.addEventListener("click", function () {
      if (phone.matches) { if (window.__closeNav) window.__closeNav(); return; }
      setRail(!isRail());
    });
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || (e.key !== "b" && e.key !== "B")) return;
      var t = e.target;
      if (phone.matches || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      if (root.getAttribute("data-state") !== "panel") return;
      e.preventDefault();
      setRail(!isRail());
    });
    var onMq = function () { hideTip(); paint(); };
    if (phone.addEventListener) phone.addEventListener("change", onMq); else if (phone.addListener) phone.addListener(onMq);

    side.addEventListener("mouseover", function (e) { var el = target(e); if (el) showTip(el); else hideTip(); });
    side.addEventListener("mouseleave", hideTip);
    side.addEventListener("focusin", function (e) { var el = target(e); if (el) showTip(el); });
    side.addEventListener("focusout", hideTip);
    side.addEventListener("click", hideTip);
    side.addEventListener("scroll", hideTip, { passive: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
