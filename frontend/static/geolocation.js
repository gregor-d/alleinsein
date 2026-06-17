// ─────────────────────────────────────────────
//  GEOLOCATION.JS — Browser Geolocation helpers
// ─────────────────────────────────────────────

/**
 * Shows a one-time-per-session prompt asking the user if they want to fly
 * to their current location. Uses the browser Geolocation API on confirmation.
 */
function showLocationPrompt() {
  if (!navigator.geolocation) return;
  if (sessionStorage.getItem("loc-prompt-dismissed")) return;

  const prompt = document.getElementById("location-prompt");
  if (!prompt) return;

  function dismiss() {
    prompt.classList.remove("open");
    sessionStorage.setItem("loc-prompt-dismissed", "1");
  }

  document.getElementById("location-prompt-yes").onclick = function () {
    dismiss();
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (mapEngine) {
        mapEngine.flyTo(
          [pos.coords.longitude, pos.coords.latitude],
          CONFIG.location_zoom,
        );
      }
    });
  };

  document.getElementById("location-prompt-no").onclick = dismiss;

  prompt.classList.add("open");
}

/**
 * Wires up a button element to trigger the browser Geolocation API.
 * On success the map flies to the user's position at CONFIG.location_zoom.
 * Uses onclick to prevent duplicate listeners when the layout is rebuilt.
 */
function bindLocBtn(id) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.onclick = function () {
    if (!navigator.geolocation) return;
    btn.classList.add("active");
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        btn.classList.remove("active");
        if (mapEngine) {
          mapEngine.flyTo(
            [pos.coords.longitude, pos.coords.latitude],
            CONFIG.location_zoom,
          );
        }
      },
      function () {
        btn.classList.remove("active");
      },
    );
  };
}

/**
 * Returns the SVG markup string for the "my location" icon used in location buttons.
 */
function getMyLocationIconSvg() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>';
}
