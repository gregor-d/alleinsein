// ─────────────────────────────────────────────
//  GEOLOCATION.JS — IP & Browser Geolocation helpers
// ─────────────────────────────────────────────

/**
 * Fetches the user's approximate location via the ipapi.co IP geolocation service.
 * Returns [longitude, latitude] on success, or null if the request fails.
 */
async function getIpLocation() {
    try {
        const res = await fetch('https://ipapi.co/json/');
        const data = await res.json();
        if (data && data.latitude && data.longitude) {
            return [data.longitude, data.latitude];
        }
    } catch (e) {
        console.info('IP Geolocation failed:', e);
    }
    return null;
}

/**
 * Wires up a button element to trigger the browser Geolocation API.
 * On success the map flies to the user's position at CONFIG.location_zoom.
 * Uses onclick to prevent duplicate listeners when the layout is rebuilt.
 */
function bindLocBtn(id) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.onclick = function() {
        if (!navigator.geolocation) return;
        btn.classList.add('active');
        navigator.geolocation.getCurrentPosition(
            function(pos) {
                btn.classList.remove('active');
                if (mapEngine) {
                    mapEngine.flyTo([pos.coords.longitude, pos.coords.latitude], CONFIG.location_zoom);
                }
            },
            function() {
                btn.classList.remove('active');
            }
        );
    };
}

/**
 * Returns the SVG markup string for the "my location" icon used in location buttons.
 */
function getMyLocationIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>';
}
