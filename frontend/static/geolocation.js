// ─────────────────────────────────────────────
//  GEOLOCATION.JS — IP & Browser Geolocation helpers
// ─────────────────────────────────────────────

async function getIpLocation() {
    try {
        const res = await fetch('https://ipapi.co/json/');
        const data = await res.json();
        if (data && data.latitude && data.longitude) {
            return [data.longitude, data.latitude];
        }
    } catch (e) {
        console.info("IP Geolocation failed:", e);
    }
    return null;
}

function bindLocBtn(id) {
    const btn = document.getElementById(id);
    if (!btn) return;
    // Use onclick to avoid listener accumulation on layout switches
    btn.onclick = () => {
        if (!navigator.geolocation) return;
        btn.classList.add('active');
        navigator.geolocation.getCurrentPosition(
            pos => {
                btn.classList.remove('active');
                if (mapEngine) {
                    const locZoom = CONFIG.location_zoom !== undefined ? CONFIG.location_zoom : (CONFIG['location-zoom'] !== undefined ? CONFIG['location-zoom'] : 14);
                    mapEngine.flyTo([pos.coords.longitude, pos.coords.latitude], locZoom);
                }
            },
            () => btn.classList.remove('active')
        );
    };
}

function getMyLocationIconSvg() {
    return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="3 11 22 2 13 21 11 13 3 11"/>
        </svg>
    `;
}
