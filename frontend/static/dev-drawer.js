// ─────────────────────────────────────────────
//  DEV-DRAWER.JS — Developer drawer-position switcher
// ─────────────────────────────────────────────

/**
 * Initialises the dev-bar position buttons.
 * Clicking a button sets data-pos on the main drawer, which CSS uses to reposition it.
 */
document.addEventListener('DOMContentLoaded', function() {
    const buttons = document.querySelectorAll('.pos-dot');
    const drawer = document.getElementById('settings-drawer');
    
    // Set default position
    let currentPos = 'top-right';

    if (drawer) {
        drawer.dataset.pos = currentPos;
    }

    function syncPosBtns(pos) {
        buttons.forEach(function(b) {
            b.classList.toggle('active', b.dataset.pos === pos);
        });
    }

    syncPosBtns(currentPos);

    buttons.forEach(function(btn) {
        btn.addEventListener('click', function() {
            currentPos = btn.dataset.pos;
            syncPosBtns(currentPos);
            if (drawer) {
                drawer.dataset.pos = currentPos;
            }
        });
    });
});
