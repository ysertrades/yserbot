/**
 * stability.js — retired, kept only so a cached index.html that still asks
 * for it gets an empty script instead of a 404.
 *
 * Everything it did now lives in app.full.js: the select/menu guard is
 * markUiBusy + isEditing, live repaints are gated per list by _sigChanged,
 * and revealOverviewChrome runs once. Its copies were older and weaker
 * (isEditing missed the Composer and custom dropdowns, renderLive never
 * refreshed Automation), and whenever it happened to load after the panel it
 * replaced the better versions — which was itself a source of flicker.
 */
