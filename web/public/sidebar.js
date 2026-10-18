/* The panel's sidebar (styles in sidebar.css).
   PC: the toggle in the brand row (or Ctrl/Cmd+B) folds the sidebar into a
   rail of icon tiles and back; the choice is remembered. Mid-size screens
   start on the rail until the user picks. On the rail, a name floats out
   beside whichever icon is hovered or focused.
   Phone: the same toggle closes the drawer, and the drawer follows the finger:
   swipe in from the left edge to open it, swipe it back to close. */
(function () {
  "use strict";
  var KEY = "qb.sidebar";
  var root = document.documentElement;
  var phone = window.matchMedia("(max-width: 900px)");
  var mac = /Mac|iPhone|iPad/.test(navigator.platform || "");
  var shortcut = mac ? "⌘B" : "Ctrl B";

  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function isRail() { return root.getAttribute("data-sb") === "rail"; }

  function paintToggle() {
    var b = document.getElementById("sb-toggle");
    if (!b) return;
    var label = phone.matches ? "Close menu" : (isRail() ? "Expand sidebar" : "Collapse sidebar");
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-expanded", phone.matches ? "true" : String(!isRail()));
    b.title = phone.matches ? label : label + " (" + shortcut + ")";
  }
  function setRail(on, remember) {
    root.setAttribute("data-sb", on ? "rail" : "open");
    if (remember) save(on ? "rail" : "open");
    hideTip();
    paintToggle();
  }

  // ── the floating name beside a rail icon ──
  var tip = null, tipFor = null;
  function tipText(el) {
    if (el.id === "sb-toggle") return [el.getAttribute("aria-label"), shortcut];
    var l = el.querySelector(".nav-label");
    if (l) return [l.textContent.trim()];
    if (el.classList.contains("sidebar-status-row")) {
      var s = el.querySelector("span:not(.val)"), v = el.querySelector(".val");
      return [s ? s.textContent.trim() : "", v ? v.textContent.trim() : ""];
    }
    return null;
  }
  function showTip(el) {
    if (!isRail() || phone.matches) return;
    var t = tipText(el);
    if (!t || !t[0]) return;
    if (!tip) { tip = document.createElement("div"); tip.className = "sb-tip"; tip.setAttribute("aria-hidden", "true"); document.body.appendChild(tip); }
    tip.textContent = t[0];
    if (t[1]) { var sm = document.createElement("small"); sm.textContent = t[1]; tip.appendChild(sm); }
    var r = el.getBoundingClientRect();
    tip.style.left = Math.round(r.right + 12) + "px";
    tip.style.top = Math.round(r.top + r.height / 2) + "px";
    tipFor = el;
    tip.classList.add("on");
  }
  function hideTip() { tipFor = null; if (tip) tip.classList.remove("on"); }
  function tipTarget(e) {
    var t = e.target;
    return t && t.closest ? t.closest(".sidebar-nav > button, #sb-toggle, .sidebar-status-row") : null;
  }

  // ── phone: the drawer follows the finger ──
  function wireSwipe(shell, side) {
    var drag = null;
    function scrim() { return document.getElementById("am-nav-scrim"); }
    function open() { return shell.classList.contains("nav-open"); }
    function clear() {
      side.style.removeProperty("transform");
      var c = scrim(); if (c) c.style.removeProperty("opacity");
      root.classList.remove("sb-dragging");
    }
    document.addEventListener("touchstart", function (e) {
      if (!phone.matches || e.touches.length !== 1 || !document.querySelector('[data-state="panel"]')) return;
      var p = e.touches[0];
      var isOpen = open();
      if (!isOpen && p.clientX > 22) return;
      if (isOpen && !side.contains(e.target) && e.target !== scrim()) return;
      drag = { x0: p.clientX, y0: p.clientY, open: isOpen, w: side.getBoundingClientRect().width || 300, live: false, last: p.clientX, t: Date.now(), v: 0 };
    }, { passive: true });
    document.addEventListener("touchmove", function (e) {
      if (!drag) return;
      var p = e.touches[0], dx = p.clientX - drag.x0, dy = p.clientY - drag.y0;
      if (!drag.live) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; } // a scroll, not a swipe
        if (Math.abs(dx) < 8) return;
        drag.live = true;
        root.classList.add("sb-dragging");
        var c = scrim(); if (c) c.hidden = false;
      }
      var now = Date.now();
      drag.v = (p.clientX - drag.last) / Math.max(1, now - drag.t);
      drag.last = p.clientX; drag.t = now;
      var off = drag.open ? Math.min(0, dx) : Math.min(0, dx - drag.w); // 0 = fully open, -w = closed
      off = Math.max(-drag.w, off);
      side.style.setProperty("transform", "translateX(" + off + "px)", "important");
      var sc = scrim(); if (sc) sc.style.setProperty("opacity", String(1 + off / drag.w), "important");
    }, { passive: true });
    function end() {
      if (!drag) return;
      var d = drag; drag = null;
      if (!d.live) return;
      var dx = d.last - d.x0;
      var shut = d.open ? (dx < -d.w * 0.33 || d.v < -0.45) : !(dx > d.w * 0.4 || d.v > 0.45);
      clear();
      if (shut) { if (window.__closeNav) window.__closeNav(); }
      else if (window.__openNav) window.__openNav();
    }
    document.addEventListener("touchend", end, { passive: true });
    document.addEventListener("touchcancel", end, { passive: true });
  }

  function boot() {
    var shell = document.querySelector(".app-shell");
    var side = shell && shell.querySelector(".sidebar");
    var toggle = document.getElementById("sb-toggle");
    if (!side || !toggle) return;

    // apply the starting state with no animation, then let transitions run
    root.classList.add("sbx", "sb-instant");
    var s = saved();
    var w = window.innerWidth;
    root.setAttribute("data-sb", s === "rail" || (s == null && w > 900 && w <= 1180) ? "rail" : "open");
    paintToggle();
    setTimeout(function () { root.classList.remove("sb-instant"); }, 80);

    toggle.addEventListener("click", function () {
      if (phone.matches) { if (window.__closeNav) window.__closeNav(); return; }
      setRail(!isRail(), true);
    });
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || (e.key !== "b" && e.key !== "B")) return;
      var t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (!document.querySelector('[data-state="panel"]')) return;
      e.preventDefault();
      if (phone.matches) { if (shell.classList.contains("nav-open")) window.__closeNav && window.__closeNav(); else window.__openNav && window.__openNav(); }
      else setRail(!isRail(), true);
    });
    var onMq = function () { hideTip(); paintToggle(); };
    if (phone.addEventListener) phone.addEventListener("change", onMq); else if (phone.addListener) phone.addListener(onMq);

    side.addEventListener("mouseover", function (e) { var el = tipTarget(e); if (el && el !== tipFor) showTip(el); else if (!el) hideTip(); });
    side.addEventListener("mouseleave", hideTip);
    side.addEventListener("focusin", function (e) { var el = tipTarget(e); if (el) showTip(el); });
    side.addEventListener("focusout", hideTip);
    side.addEventListener("click", hideTip);
    side.addEventListener("scroll", hideTip, { passive: true });

    wireSwipe(shell, side);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
