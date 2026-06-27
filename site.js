/* ============================================================
   Shared site chrome — loaded by every sub-page (not index.html).
   Single source of truth for the back-navigation link.

   Each sub-page carries an empty placeholder:
       <div class="back" data-nav></div>
   and this script fills it. To change the nav everywhere
   (label, target, add a "Quiz" shortcut, breadcrumbs…),
   edit NAV_HTML below — one place, all 32 pages update.
   Works over file:// — no build step, no network.
   ============================================================ */
(function () {
  var NAV_HTML = '<a href="index.html">← All materials</a>';

  function renderNav() {
    var slots = document.querySelectorAll('.back[data-nav]');
    for (var i = 0; i < slots.length; i++) {
      slots[i].innerHTML = NAV_HTML;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderNav);
  } else {
    renderNav();
  }
})();
