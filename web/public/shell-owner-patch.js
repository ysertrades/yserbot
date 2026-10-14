(function () {
  "use strict";
  function patch() {
    try {
      if (typeof el === "function" && !el.__amPatched) {
        el = function (tag, className, text) {
          var node = document.createElement(tag);
          if (className) node.className = className;
          if (text !== undefined && text !== null) {
            if (typeof text === "object" && text.nodeType) node.appendChild(text);
            else node.textContent = text;
          }
          return node;
        };
        el.__amPatched = true;
      }
      if (typeof renderOwnerConsole === "function" && !renderOwnerConsole.__amPatched) {
        var _roc = renderOwnerConsole;
        renderOwnerConsole = function () {
          try {
            (window.state && window.state.ownerGuilds || []).forEach(function (g) {
              if (!g.staff) g.staff = [];
            });
          } catch (e) {}
          return _roc.apply(this, arguments);
        };
        renderOwnerConsole.__amPatched = true;
      }
    } catch (e) {}
  }
  var n = 0;
  var t = setInterval(function () {
    patch();
    if (++n > 80) clearInterval(t);
  }, 400);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", patch);
  else patch();
})();
