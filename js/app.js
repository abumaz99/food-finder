/**
 * Forkward — Holiday Food Finder
 * Main application logic: state, data fetching, rendering, map.
 */

// ============ STATE ============
const INITIAL_VISIBLE_RESULTS = 100;
const RESULTS_INCREMENT = 100;
const MAP_CLUSTER_SIZE_PX = 64;
const OVERPASS_TIMEOUT_MS = 18000;
const OVERPASS_STAGGER_MS = 1200;
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const FAVORITES_STORAGE_KEY = 'forkward:favorites';
const OVERPASS_ENDPOINT_STORAGE_KEY = 'forkward:lastOverpassEndpoint';

const state = {
  lat: null,
  lon: null,
  locationLabel: '',
  lastGeocodedInput: '',
  lastGeocodedCoords: null,
  results: [],
  filteredResults: [],
  favorites: [],
  visibleCount: INITIAL_VISIBLE_RESULTS,
  searchRadiusKm: null,
  selectedPrices: new Set([1, 2, 3, 4]),
  selectedCuisines: new Set(),
  map: null,
  markers: [],
  searchController: null,
  currentTab: 'list',
  searching: false
};

// ============ INIT ============
function init() {
  loadFavorites();
  updateFavoriteCount();

  // Date in masthead
  const d = new Date();
  const dateStr = d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).toUpperCase();
  document.getElementById('dateline').textContent = `— ${dateStr} —`;

  // Cuisine pills
  const cuisinePills = document.getElementById('cuisinePills');
  Object.keys(CUISINES).forEach(cuisine => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'pill';
    pill.textContent = cuisine;
    pill.dataset.cuisine = cuisine;
    pill.setAttribute('aria-pressed', 'false');
    pill.addEventListener('click', () => {
      toggleCuisineFilter(pill, cuisine);
    });
    cuisinePills.appendChild(pill);
  });

  // Price pills
  document.querySelectorAll('#pricePills .pill').forEach(pill => {
    pill.setAttribute('aria-pressed', 'true');
    pill.addEventListener('click', () => {
      togglePriceFilter(pill);
    });
  });

  // Distance display
  const distanceInput = document.getElementById('distance');
  const distanceVal = document.getElementById('distanceVal');
  distanceInput.addEventListener('input', () => {
    distanceVal.textContent = `${getDistanceKm().toFixed(1)} km`;
    if (state.results.length) refreshFilters();
  });
  distanceInput.addEventListener('change', () => {
    if (!state.results.length || state.searching) return;
    if (state.searchRadiusKm !== null && getDistanceKm() > state.searchRadiusKm) {
      search();
    }
  });

  document.getElementById('gpsBtn').addEventListener('click', useGPS);
  document.getElementById('searchBtn').addEventListener('click', () => {
    if (state.searching) cancelSearch();
    else search();
  });
  document.getElementById('surpriseBtn').addEventListener('click', surpriseMe);

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  document.getElementById('sortBy').addEventListener('change', () => {
    state.visibleCount = INITIAL_VISIBLE_RESULTS;
    sortAndRender();
  });

  document.getElementById('openNowOnly').addEventListener('change', () => {
    if (state.results.length) refreshFilters();
  });

  document.getElementById('surpriseAgain').addEventListener('click', surpriseMe);
  document.getElementById('surpriseClose').addEventListener('click', () => {
    document.getElementById('surpriseBox').classList.remove('visible');
  });
}

function toggleCuisineFilter(pill, cuisine) {
  const isActive = pill.classList.toggle('active');
  pill.setAttribute('aria-pressed', String(isActive));
  if (isActive) {
    state.selectedCuisines.add(cuisine);
  } else {
    state.selectedCuisines.delete(cuisine);
  }
  if (state.results.length) refreshFilters();
}

function togglePriceFilter(pill) {
  const price = parseInt(pill.dataset.price);
  const isActive = pill.classList.toggle('active');
  pill.setAttribute('aria-pressed', String(isActive));
  if (isActive) {
    state.selectedPrices.add(price);
  } else {
    state.selectedPrices.delete(price);
  }
  if (state.results.length) refreshFilters();
}

function refreshFilters() {
  state.visibleCount = INITIAL_VISIBLE_RESULTS;
  applyFilters();
  sortAndRender();
}

// ============ GPS ============
function useGPS() {
  const btn = document.getElementById('gpsBtn');
  if (!navigator.geolocation) {
    showError('Geolocation not supported by your browser.');
    return;
  }
  btn.textContent = '...';
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    pos => {
      state.lat = pos.coords.latitude;
      state.lon = pos.coords.longitude;
      state.lastGeocodedInput = '';
      state.lastGeocodedCoords = null;
      document.getElementById('location').value =
        `${state.lat.toFixed(4)}, ${state.lon.toFixed(4)}`;
      state.locationLabel = 'your location';
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '⊙'; btn.disabled = false; }, 1200);
    },
    err => {
      showError('Location access denied. Try entering it manually.');
      btn.textContent = '⊙';
      btn.disabled = false;
    },
    { timeout: 10000, enableHighAccuracy: true }
  );
}

// ============ GEOCODE ============
async function geocode(query, signal) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
  const controller = new AbortController();
  const abortSearch = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abortSearch, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
    if (!res.ok) throw new Error('Geocoding failed');
    const data = await res.json();
    if (!data.length) throw new Error('Location not found');
    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      display: data[0].display_name
    };
  } catch (e) {
    if (e.name === 'AbortError' && signal && signal.aborted) throw e;
    if (e.name === 'AbortError') throw new Error('Geocoding timed out — try again');
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abortSearch);
  }
}

// ============ OVERPASS FETCH ============
async function fetchOverpass(query, signal) {
  if (signal && signal.aborted) throw new DOMException('Search cancelled', 'AbortError');

  updateSearchStatus('Looking for nearby food spots…');

  let lastStatus = null;
  const controllers = [];
  const raceController = new AbortController();
  const abortRace = () => raceController.abort();
  if (signal) signal.addEventListener('abort', abortRace, { once: true });

  const endpoints = getPreferredOverpassEndpoints();
  const requests = endpoints.map((endpoint, index) =>
    delayedOverpassRequest(endpoint, query, raceController.signal, index * OVERPASS_STAGGER_MS, controllers)
      .then(data => ({ endpoint, data }))
      .catch(err => {
        if (raceController.signal.aborted) throw err;
        if (err && err.status) lastStatus = err.status;
        throw err;
      })
  );

  try {
    const winner = await firstSuccessful(requests);
    rememberOverpassEndpoint(winner.endpoint);
    return winner.data;
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw overpassUnavailableError(lastStatus);
  } finally {
    raceController.abort();
    if (signal) signal.removeEventListener('abort', abortRace);
    controllers.forEach(controller => controller.abort());
  }
}

async function delayedOverpassRequest(endpoint, query, signal, delayMs, controllers) {
  if (delayMs > 0) {
    await delay(delayMs, signal);
  }
  if (signal && signal.aborted) throw new DOMException('Search cancelled', 'AbortError');

  const controller = new AbortController();
  controllers.push(controller);
  const abortSearch = () => controller.abort();
  if (signal) signal.addEventListener('abort', abortSearch, { once: true });
  const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'data=' + encodeURIComponent(query),
      signal: controller.signal
    });

    if (!res.ok) {
      const err = new Error(`Overpass returned ${res.status}`);
      err.status = res.status;
      throw err;
    }

    return res.json();
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abortSearch);
  }
}

function firstSuccessful(promises) {
  return new Promise((resolve, reject) => {
    let rejectedCount = 0;
    let lastError = null;

    promises.forEach(promise => {
      promise.then(resolve).catch(err => {
        rejectedCount += 1;
        lastError = err;
        if (rejectedCount === promises.length) reject(lastError);
      });
    });
  });
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new DOMException('Search cancelled', 'AbortError'));
      return;
    }

    let abortDelay = null;
    const timer = setTimeout(() => {
      if (signal && abortDelay) signal.removeEventListener('abort', abortDelay);
      resolve();
    }, ms);
    abortDelay = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abortDelay);
      reject(new DOMException('Search cancelled', 'AbortError'));
    };
    if (signal) signal.addEventListener('abort', abortDelay, { once: true });
  });
}

function getPreferredOverpassEndpoints() {
  let preferred = null;
  try {
    preferred = localStorage.getItem(OVERPASS_ENDPOINT_STORAGE_KEY);
  } catch (_) {
    preferred = null;
  }
  if (!preferred || !OVERPASS_ENDPOINTS.includes(preferred)) return OVERPASS_ENDPOINTS;
  return [preferred, ...OVERPASS_ENDPOINTS.filter(endpoint => endpoint !== preferred)];
}

function rememberOverpassEndpoint(endpoint) {
  try {
    localStorage.setItem(OVERPASS_ENDPOINT_STORAGE_KEY, endpoint);
  } catch (_) {
    // A remembered endpoint is only an optimization.
  }
}

function overpassUnavailableError(lastStatus) {
  const hint = lastStatus === 429
    ? 'rate-limited — wait a moment'
    : 'all servers busy — try a smaller radius';
  return new Error(`Map data is busy (${hint})`);
}

// ============ SEARCH ============
async function search() {
  if (state.searching) return;

  hideError();
  const locInput = document.getElementById('location').value.trim();
  if (!locInput && (state.lat === null || state.lon === null)) {
    showError('Please enter a location or use GPS.');
    return;
  }

  state.searching = true;
  state.searchController = new AbortController();
  const searchBtn = document.getElementById('searchBtn');
  const originalLabel = searchBtn.textContent;
  searchBtn.textContent = 'Cancel Search';
  showLoading();

  try {
    if (locInput && !locInput.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/)) {
      if (locInput !== state.lastGeocodedInput || !state.lastGeocodedCoords) {
        updateSearchStatus('Finding those coordinates…');
        const geo = await geocode(locInput, state.searchController.signal);
        state.lat = geo.lat;
        state.lon = geo.lon;
        state.locationLabel = geo.display.split(',')[0];
        state.lastGeocodedInput = locInput;
        state.lastGeocodedCoords = { lat: geo.lat, lon: geo.lon };
      } else {
        state.lat = state.lastGeocodedCoords.lat;
        state.lon = state.lastGeocodedCoords.lon;
      }
    } else if (locInput.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/)) {
      const [lat, lon] = locInput.split(',').map(s => parseFloat(s.trim()));
      state.lat = lat;
      state.lon = lon;
      state.lastGeocodedInput = '';
      state.lastGeocodedCoords = null;
    }

    if (state.lat === null || state.lon === null) throw new Error('Could not determine location');

    const radiusKm = getDistanceKm();
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
      throw new Error('Choose a valid distance');
    }

    const radius = Math.round(radiusKm * 1000);
    const q = `[out:json][timeout:14];
(
  node["amenity"~"^(restaurant|cafe|pub|bar|fast_food)$"](around:${radius},${state.lat},${state.lon});
  way["amenity"~"^(restaurant|cafe|pub|bar|fast_food)$"](around:${radius},${state.lat},${state.lon});
);
out center qt tags;`;

    const data = await fetchOverpass(q, state.searchController.signal);

    state.results = data.elements
      .map(el => parseElement(el))
      .filter(r => r && r.name && r.distance <= radiusKm);
    state.searchRadiusKm = radiusKm;
    state.visibleCount = INITIAL_VISIBLE_RESULTS;

    applyFilters();
    sortAndRender();
  } catch (err) {
    if (isAbortError(err)) {
      if (state.filteredResults.length) {
        renderResults();
      } else {
        showIdleStatus('Search cancelled', 'Adjust the filters or try again when you are ready.');
      }
    } else {
      showError('Search failed: ' + err.message);
      if (state.filteredResults.length) {
        renderResults();
      } else {
        showIdleStatus('Search could not finish', 'Try again in a moment, or use a smaller radius while map data is busy.');
      }
    }
  } finally {
    state.searching = false;
    searchBtn.textContent = originalLabel;
    state.searchController = null;
  }
}

function cancelSearch() {
  if (state.searchController) state.searchController.abort();
}

function isAbortError(err) {
  return err && err.name === 'AbortError';
}

// ============ PARSE OSM ELEMENT ============
function parseElement(el) {
  const tags = el.tags || {};
  if (!tags.name) return null;

  const lat = Number(el.lat ?? (el.center && el.center.lat));
  const lon = Number(el.lon ?? (el.center && el.center.lon));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const dist = haversine(state.lat, state.lon, lat, lon);

  // Map OSM cuisine tags to our display categories
  const osmCuisines = (tags.cuisine || '').toLowerCase()
    .split(/[;,]/).map(s => s.trim()).filter(Boolean);
  const amenity = tags.amenity || '';
  if (amenity === 'cafe') osmCuisines.push('cafe');
  if (amenity === 'pub')  osmCuisines.push('pub');
  if (amenity === 'bar')  osmCuisines.push('bar');

  let displayCuisines = [];
  for (const [label, tagsList] of Object.entries(CUISINES)) {
    if (osmCuisines.some(c => tagsList.includes(c))) displayCuisines.push(label);
  }
  if (!displayCuisines.length) {
    if (osmCuisines.length) {
      displayCuisines.push(
        osmCuisines[0].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      );
    } else {
      const cap = amenity.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      displayCuisines.push(cap || 'Restaurant');
    }
  }

  // Approximate price level (OSM has no price tag)
  let price = 2;
  if      (amenity === 'fast_food')               price = 1;
  else if (amenity === 'cafe')                    price = 1;
  else if (amenity === 'pub' || amenity === 'bar') price = 2;
  else if (amenity === 'restaurant')              price = 2;

  const nameLow = (tags.name || '').toLowerCase();
  if      (/michelin|fine dining|tasting menu|haute/.test(nameLow)) price = 4;
  else if (tags['stars'] || tags['michelin_stars'])                 price = 4;

  const addrParts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:city'] || tags['addr:suburb']
  ].filter(Boolean);
  const address = addrParts.join(' ') || 'Address unavailable';

  const openingHours = tags.opening_hours || null;
  const isOpen = openingHours ? checkOpenNow(openingHours) : null;

  return {
    id: `${el.type}/${el.id}`,
    name: tags.name,
    lat, lon,
    distance: dist,
    cuisines: displayCuisines,
    price,
    address,
    phone: tags.phone || tags['contact:phone'] || null,
    website: tags.website || tags['contact:website'] || null,
    openingHours,
    isOpen,
    osmType: el.type,
    osmId: el.id
  };
}

// ============ FILTER / SORT ============
function getDistanceKm() {
  return parseFloat(document.getElementById('distance').value);
}

function formatDistance(distanceKm) {
  return distanceKm < 1
    ? `${Math.round(distanceKm * 1000)} m`
    : `${distanceKm.toFixed(1)} km`;
}

function safeHttpUrl(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch (_) {
    return null;
  }
}

function applyFilters() {
  const openNowOnly = document.getElementById('openNowOnly').checked;
  const radiusKm = getDistanceKm();
  state.filteredResults = state.results.filter(r => {
    if (Number.isFinite(radiusKm) && r.distance > radiusKm) return false;
    if (!state.selectedPrices.has(r.price)) return false;
    if (state.selectedCuisines.size > 0) {
      const matches = r.cuisines.some(c => state.selectedCuisines.has(c));
      if (!matches) return false;
    }
    if (openNowOnly && r.isOpen !== true) return false;
    return true;
  });
}

function sortAndRender() {
  const sortBy = document.getElementById('sortBy').value;
  state.filteredResults.sort((a, b) => {
    if (sortBy === 'distance')   return a.distance - b.distance;
    if (sortBy === 'name')       return a.name.localeCompare(b.name);
    if (sortBy === 'price-low')  return a.price - b.price;
    if (sortBy === 'price-high') return b.price - a.price;
    return 0;
  });
  renderResults();
  if (state.currentTab === 'map') renderMap();
}

// ============ RENDER ============
function renderResults() {
  document.getElementById('initialStatus').style.display = 'none';
  document.getElementById('resultsContent').style.display = 'block';
  const grid = document.getElementById('grid');
  document.getElementById('resultCount').textContent = state.filteredResults.length;
  document.getElementById('listCount').textContent = `(${state.filteredResults.length})`;

  if (!state.filteredResults.length) {
    grid.innerHTML = `<div class="status" style="grid-column: 1/-1;">
      <div class="ornament">∅</div>
      <h3>Nothing matches</h3>
      <p>Loosen the filters, or try a wider radius.</p>
    </div>`;
    return;
  }

  const visibleResults = getVisibleResults();
  const remaining = state.filteredResults.length - visibleResults.length;
  const expandedRadiusNote = getExpandedRadiusNote();
  grid.innerHTML = visibleResults.map(r => cardHTML(r)).join('')
    + `${remaining > 0 ? loadMoreHTML(remaining) : ''}`
    + `${expandedRadiusNote ? resultNoticeHTML(expandedRadiusNote) : ''}`;

  grid.querySelectorAll('.fav-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleFavorite(btn.dataset.id);
    });
  });
  const loadMoreBtn = document.getElementById('loadMoreResults');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      state.visibleCount += RESULTS_INCREMENT;
      renderResults();
    });
  }
}

function getVisibleResults() {
  return state.filteredResults.slice(0, state.visibleCount);
}

function loadMoreHTML(remaining) {
  const nextCount = Math.min(RESULTS_INCREMENT, remaining);
  return `
    <div class="result-limit" style="grid-column: 1/-1;">
      <p>Showing the nearest ${getVisibleResults().length} of ${state.filteredResults.length} matching food spots.</p>
      <button id="loadMoreResults" type="button">Show ${nextCount} More</button>
    </div>
  `;
}

function resultNoticeHTML(message) {
  return `
    <div class="result-limit subtle" style="grid-column: 1/-1;">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function getExpandedRadiusNote() {
  const radiusKm = getDistanceKm();
  if (state.searchRadiusKm !== null && radiusKm > state.searchRadiusKm) {
    return `Showing matches from the last ${state.searchRadiusKm.toFixed(1)} km search. Run search again to expand to ${radiusKm.toFixed(1)} km.`;
  }
  return '';
}

function cardHTML(r) {
  const isFav = state.favorites.some(f => f.id === r.id);
  const priceStr = '£'.repeat(r.price);
  const distStr = formatDistance(r.distance);
  let openTag = '';
  if      (r.isOpen === true)  openTag = '<span class="open-now">● Open now</span>';
  else if (r.isOpen === false) openTag = '<span class="closed-now">● Closed</span>';

  const osmUrl = `https://www.openstreetmap.org/${r.osmType}/${r.osmId}`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}`;
  const websiteUrl = safeHttpUrl(r.website);

  return `
    <article class="card" data-id="${r.id}">
      <div class="card-header">
        <h3>${escapeHtml(r.name)}</h3>
        <button class="fav-btn ${isFav ? 'active' : ''}" data-id="${r.id}" title="${isFav ? 'Remove from favourites' : 'Save to favourites'}">★</button>
      </div>
      <div class="cuisine-tag">${escapeHtml(r.cuisines.join(' · '))}</div>
      <div class="card-meta">
        <span class="price">${priceStr}</span>
        <span>· ${distStr}</span>
        ${openTag ? `<span>·</span>${openTag}` : ''}
      </div>
      <div class="address">${escapeHtml(r.address)}</div>
      <div class="card-footer">
        <a class="mini-btn" href="${directionsUrl}" target="_blank" rel="noopener">↗ Directions</a>
        ${websiteUrl ? `<a class="mini-btn" href="${escapeAttr(websiteUrl)}" target="_blank" rel="noopener">⌘ Website</a>` : ''}
        <a class="mini-btn" href="${osmUrl}" target="_blank" rel="noopener">ⓘ More</a>
      </div>
    </article>
  `;
}

// ============ FAVORITES ============
function toggleFavorite(id) {
  const r = state.results.find(x => x.id === id)
         || state.favorites.find(x => x.id === id);
  if (!r) return;
  const idx = state.favorites.findIndex(f => f.id === id);
  if (idx >= 0) state.favorites.splice(idx, 1);
  else          state.favorites.push(r);

  saveFavorites();
  updateFavoriteCount();
  renderResults();
  renderFavorites();
}

function loadFavorites() {
  try {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    state.favorites = Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    state.favorites = [];
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(state.favorites));
  } catch (_) {
    // Favourites still work for this session if storage is unavailable.
  }
}

function updateFavoriteCount() {
  document.getElementById('favCount').textContent = state.favorites.length;
}

function renderFavorites() {
  const status = document.getElementById('favStatus');
  const grid = document.getElementById('favGrid');
  if (!state.favorites.length) {
    status.style.display = 'block';
    grid.style.display = 'none';
    grid.innerHTML = '';
    return;
  }
  status.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = state.favorites.map(r => cardHTML(r)).join('');
  grid.querySelectorAll('.fav-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleFavorite(btn.dataset.id);
    });
  });
}

// ============ MAP ============
function renderMap(options = {}) {
  const preserveView = options.preserveView === true;
  if (!state.map) {
    state.map = L.map('map').setView([
      state.lat !== null ? state.lat : 51.5,
      state.lon !== null ? state.lon : -0.1
    ], 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(state.map);
    state.map.on('zoomend', () => renderMap({ preserveView: true }));
  } else {
    if (state.lat !== null && state.lon !== null && !preserveView) {
      state.map.setView([state.lat, state.lon], 14);
    }
  }
  clearMapMarkers();

  if (state.lat !== null && state.lon !== null) {
    const userIcon = L.divIcon({
      className: '',
      html: '<div class="map-user-marker"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
    const m = L.marker([state.lat, state.lon], { icon: userIcon }).addTo(state.map);
    m.bindPopup('<strong>You are here</strong>');
    state.markers.push(m);
  }

  getMapClusters().forEach(cluster => {
    const marker = cluster.items.length === 1
      ? createPlaceMarker(cluster.items[0])
      : createClusterMarker(cluster);
    state.markers.push(marker);
  });
}

function clearMapMarkers() {
  state.markers.forEach(m => state.map.removeLayer(m));
  state.markers = [];
}

function getMapClusters() {
  if (!state.map) return [];

  const zoom = state.map.getZoom();
  const groups = new Map();
  state.filteredResults.forEach(r => {
    const point = state.map.project([r.lat, r.lon], zoom);
    const key = `${Math.floor(point.x / MAP_CLUSTER_SIZE_PX)}:${Math.floor(point.y / MAP_CLUSTER_SIZE_PX)}`;
    if (!groups.has(key)) {
      groups.set(key, { items: [], latTotal: 0, lonTotal: 0 });
    }
    const group = groups.get(key);
    group.items.push(r);
    group.latTotal += r.lat;
    group.lonTotal += r.lon;
  });

  return [...groups.values()].map(group => ({
    items: group.items,
    lat: group.latTotal / group.items.length,
    lon: group.lonTotal / group.items.length
  }));
}

function createPlaceMarker(r) {
  const icon = L.divIcon({
    className: '',
    html: `<div class="map-price-marker">${'£'.repeat(r.price)}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
  const marker = L.marker([r.lat, r.lon], { icon }).addTo(state.map);
  marker.bindPopup(placePopupHTML(r));
  return marker;
}

function createClusterMarker(cluster) {
  const icon = L.divIcon({
    className: '',
    html: `<div class="map-cluster-marker">${cluster.items.length}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
  const marker = L.marker([cluster.lat, cluster.lon], { icon }).addTo(state.map);
  marker.bindPopup(clusterPopupHTML(cluster.items));
  return marker;
}

function placePopupHTML(r) {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(r.name + ' ' + r.address)}`;
  return `
    <div class="map-popup">
      <h4><a href="${searchUrl}" target="_blank" rel="noopener">${escapeHtml(r.name)}</a></h4>
      <p>${escapeHtml(r.cuisines.join(' · '))}</p>
      <p>${'£'.repeat(r.price)} · ${formatDistance(r.distance)}</p>
    </div>
  `;
}

function clusterPopupHTML(items) {
  const nearest = [...items].sort((a, b) => a.distance - b.distance).slice(0, 5);
  return `
    <div class="map-popup">
      <h4>${items.length} food spots nearby</h4>
      <p>${nearest.map(r => `${escapeHtml(r.name)} (${formatDistance(r.distance)})`).join('<br>')}</p>
    </div>
  `;
}

// ============ SURPRISE ============
function surpriseMe() {
  if (!state.filteredResults.length) {
    showError('Run a search first, then I can pick.');
    return;
  }
  const r = state.filteredResults[Math.floor(Math.random() * state.filteredResults.length)];
  document.getElementById('surpriseMeta').textContent =
    `${'£'.repeat(r.price)} · ${r.cuisines[0]} · ${formatDistance(r.distance)} away`;
  document.getElementById('surpriseName').textContent = r.name;
  document.getElementById('surpriseAddr').textContent = r.address;
  document.getElementById('surpriseBox').classList.add('visible');
  switchTab('list');
  document.getElementById('surpriseBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ============ TABS ============
function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab)
  );
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
  document.getElementById('tab-' + tab).style.display = 'block';
  if (tab === 'map') {
    setTimeout(() => {
      renderMap();
      if (state.map) state.map.invalidateSize();
    }, 50);
  }
  if (tab === 'favorites') renderFavorites();
}

// ============ STATUS / ERROR ============
function showLoading() {
  document.getElementById('initialStatus').style.display = 'block';
  document.getElementById('resultsContent').style.display = 'none';
  document.getElementById('initialStatus').innerHTML = `
    <div class="spinner"></div>
    <h3 style="margin-top:18px;">Consulting the almanack…</h3>
    <p id="searchStatusText">Sifting through the neighbourhood for places worth eating.</p>
  `;
}

function updateSearchStatus(message) {
  const status = document.getElementById('searchStatusText');
  if (status) status.textContent = message;
}

function showIdleStatus(title, message) {
  document.getElementById('initialStatus').style.display = 'block';
  document.getElementById('resultsContent').style.display = 'none';
  document.getElementById('initialStatus').innerHTML = `
    <div class="ornament">❦</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(message)}</p>
  `;
}

function showError(msg) {
  const box = document.getElementById('errorBox');
  box.className = 'error-msg';
  box.textContent = msg;
  box.style.display = 'block';
  setTimeout(hideError, 5000);
}

function hideError() {
  document.getElementById('errorBox').style.display = 'none';
}

// ============ GO ============
init();
