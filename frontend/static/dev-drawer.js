// ─────────────────────────────────────────────
//  DEV-DRAWER.JS — Developer drawer-position switcher
// ─────────────────────────────────────────────

/**
 * Initialises the dev-bar position buttons.
 * Clicking a button sets data-pos on the main drawer, which CSS uses to reposition it.
 */
document.addEventListener('DOMContentLoaded', function() {
    const buttons = document.querySelectorAll('.dev-pos-btn');
    const drawer = document.getElementById('settings-drawer');
    
    // Set default position
    let currentPos = 'right-middle';

    if (drawer) {
        drawer.dataset.pos = currentPos;
    }

    buttons.forEach(function(btn) {
        btn.addEventListener('click', function() {
            buttons.forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            currentPos = btn.dataset.pos;
            if (drawer) {
                drawer.dataset.pos = currentPos;
            }
        });
    });
});
