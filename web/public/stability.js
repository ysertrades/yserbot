/**
 * stability.js — loaded after app.js.
 *
 * Real root causes this fixes:
 *
 * 1) Dropdowns closing
 *    The live SSE stream rebuilds the overview every ~3s. While a native
 *    <select> popup is open, many browsers move focus off the <select>, so
 *    isEditing() returned false and renderLive() ran. Setting transform on
 *    ancestor panels (revealOverviewChrome) and/or replacing DOM closed the
 *    menu. We track select interaction explicitly and skip live repaints
 *    while a menu is open.
 *
 * 2) Hover shake / flicker on lists (tracking logs, reports, giveaways, …)
 *    renderLive() called replaceChildren() on those lists whenever ANY
 *    overview field changed. The node under the cursor was destroyed and
 *    rebuilt every few seconds → visible shake. We only rebuild a list when
 *    its own data signature changed.
 *
 * 3) Launch / ongoing transform thrash
 *    revealOverviewChrome forced inline transform:none on every panel on
 *    every live tick. That is only needed once after the entrance animation.
 */
(function () {
  'use strict';

  let selectOpen = false;
  let selectCloseTimer = null;

  function markSelectOpen() {
    selectOpen = true;
    if (selectCloseTimer) {
      clearTimeout(selectCloseTimer);
      selectCloseTimer = null;
    }
  }

  function markSelectClosedSoon() {
    if (selectCloseTimer) clearTimeout(selectCloseTimer);
    // Native menus fire blur/change in inconsistent order across browsers.
    selectCloseTimer = setTimeout(() => {
      selectOpen = false;
      selectCloseTimer = null;
      // Flush a deferred live paint now that it is safe.
      if (typeof liveMissed !== 'undefined' && liveMissed && typeof renderLive === 'function') {
        try { renderLive(); } catch (_) { /* app not ready */ }
      }
    }, 150);
  }

  document.addEventListener('mousedown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'SELECT' || (t.closest && t.closest('select')))) {
      markSelectOpen();
    }
  }, true);

  document.addEventListener('focusin', (e) => {
    if (e.target && e.target.tagName === 'SELECT') markSelectOpen();
  }, true);

  document.addEventListener('focusout', (e) => {
    if (e.target && e.target.tagName === 'SELECT') markSelectClosedSoon();
  }, true);

  document.addEventListener('change', (e) => {
    if (e.target && e.target.tagName === 'SELECT') markSelectClosedSoon();
  }, true);

  // details/summary fold cards — pause destructive rebuilds while open
  document.addEventListener('toggle', (e) => {
    if (e.target && e.target.tagName === 'DETAILS' && e.target.open) {
      markSelectOpen();
    } else if (e.target && e.target.tagName === 'DETAILS' && !e.target.open) {
      markSelectClosedSoon();
    }
  }, true);

  function stableIsEditing() {
    if (selectOpen) return true;
    const a = document.activeElement;
    if (!a) return false;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
    if (a.isContentEditable === true) return true;
    if (document.querySelector('select:focus, details[open] summary:focus')) return true;
    return false;
  }

  const sig = Object.create(null);
  function fingerprint(value) {
    try { return JSON.stringify(value); }
    catch (_) { return String(value); }
  }
  function changed(key, value) {
    const next = fingerprint(value);
    if (sig[key] === next) return false;
    sig[key] = next;
    return true;
  }

  function stableRevealOverviewChrome() {
    if (document.documentElement.dataset.entered === '1') return;
    requestAnimationFrame(() => {
      document.querySelectorAll(
        '.tiles > *:not(.ph), .section[data-active] .panel, .section[data-active]'
      ).forEach((node) => {
        node.style.opacity = '1';
        node.style.transform = 'none';
      });
    });
    setTimeout(() => {
      document.documentElement.dataset.entered = '1';
    }, 700);
  }

  function stableRenderLive() {
    if (typeof state === 'undefined' || !state.overview) return;
    if (stableIsEditing() || (typeof sheetIsOpen === 'function' && sheetIsOpen())) {
      if (typeof liveMissed !== 'undefined') liveMissed = true;
      return;
    }
    if (typeof liveMissed !== 'undefined') liveMissed = false;

    if (typeof renderOverviewCards === 'function') renderOverviewCards();
    stableRevealOverviewChrome();

    const o = state.overview;

    if (typeof renderGiveaways === 'function' && changed('giveaways', o.giveaways)) {
      renderGiveaways();
    }
    if (typeof renderLottery === 'function' && changed('lottery', o.lottery || o.features && o.features.groups && o.features.groups.lottery)) {
      renderLottery();
    }
    if (typeof renderModeration === 'function' && changed('mod', o.mod)) {
      renderModeration();
    }
    if (typeof renderLinkRequests === 'function' && changed('links', o.linkRequests || o.links)) {
      renderLinkRequests();
    }
    if (typeof renderTickets === 'function' && changed('tickets', o.tickets)) {
      renderTickets();
    }
    if (typeof renderSocial === 'function') {
      const socialBusy = state.socialDraft || (state.socialOpen && state.socialOpen.size);
      if (!socialBusy && changed('social', o.social)) renderSocial();
    }
    if (typeof startTicking === 'function') startTicking();
  }

  function install() {
    try { isEditing = stableIsEditing; } catch (_) { window.isEditing = stableIsEditing; }
    try { renderLive = stableRenderLive; } catch (_) { window.renderLive = stableRenderLive; }
    try { revealOverviewChrome = stableRevealOverviewChrome; } catch (_) { window.revealOverviewChrome = stableRevealOverviewChrome; }

    if (typeof startLive === 'function' && typeof state !== 'undefined' && state.guildId) {
      try { startLive(); } catch (_) { /* ignore */ }
    }

    console.info('[stability] live-render + select guards installed');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
