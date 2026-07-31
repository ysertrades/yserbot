'use strict';

/* Runs in the popup that finished a Discord login.
   Hands the session token to the panel that opened it, then closes.

   The token is targeted at our own origin explicitly rather than '*', so a
   page on another origin can never receive it even if it somehow became the
   opener. */

const body = document.body;
const token = body.dataset.token;
const origin = body.dataset.origin;

if (window.opener && token && origin) {
  window.opener.postMessage({ type: 'yserflow-session', token }, origin);
}
window.close();
