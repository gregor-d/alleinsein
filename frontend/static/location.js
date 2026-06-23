// ─────────────────────────────────────────────
//  LOCATION.JS — Geolocation (GPS) + place search
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

// ─── PLACE SEARCH (geocoding) ─────────────────

// Geocodes the query via Nominatim and renders up to 5 matches into the given
// results list (defaults to the FAB popover's list). Picking a result flies the
// map there and runs the optional onSelect callback (e.g. close the popover).
async function doSearch(query, list, onSelect) {
  if (!query || !mapEngine) return;

  list = list || document.getElementById("search-popover-results");
  if (!list) return;

  list.innerHTML = '<li class="result-empty">Searching…</li>';

  try {
    var url =
      "https://nominatim.openstreetmap.org/search?q=" +
      encodeURIComponent(query) +
      "&format=json&limit=5&countrycodes=de&email=kontakt@alleinseinkarte.de";
    var res = await fetch(url, { headers: { "Accept-Language": "de" } });
    var data = await res.json();

    list.innerHTML = "";
    if (!data || !data.length) {
      list.innerHTML = '<li class="result-empty">No results found.</li>';
      return;
    }

    data.forEach(function (item) {
      var parts = item.display_name.split(",");
      var li = document.createElement("li");
      li.innerHTML =
        '<div class="result-name">' +
        parts[0].trim() +
        "</div>" +
        '<div class="result-detail">' +
        parts
          .slice(1, 3)
          .map(function (s) {
            return s.trim();
          })
          .join(", ") +
        "</div>";
      li.addEventListener("click", function () {
        mapEngine.flyTo(
          [parseFloat(item.lon), parseFloat(item.lat)],
          CONFIG.location_zoom,
        );
        if (typeof onSelect === "function") onSelect();
      });
      list.appendChild(li);
    });
  } catch (err) {
    console.warn("Search failed:", err);
    list.innerHTML = '<li class="result-empty">Search failed.</li>';
  }
}
