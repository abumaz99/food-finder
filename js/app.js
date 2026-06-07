/**
 * Forkward — Holiday Food Finder
 * Main application logic: state, Google Places fetching, rendering, map.
 */

// ============ STATE ============
const INITIAL_VISIBLE_RESULTS = 20;
const RESULTS_INCREMENT = 20;
const FAVORITES_STORAGE_KEY = 'forkward:favorites';
const DEFAULT_MAP_CENTER = { lat: 51.5074, lng: -0.1278 };

let googleMapsLoadPromise = null;

const state = {
  config: null,
  lat: null,
  lon: null,
  locationLabel: '',
  lastGeocodedInput: '',
  lastGeocodedCoords: null,
  results: [],
  filteredResults: [],
  favorites: [],
  visibleCount: INITIAL_VISIBLE_RESULTS,
  requestedRadiusKm: null,
  searchRadiusKm: null,
  searchExpanded: false,
  relaxedTypes: false,
  resultNotice: '',
  selectedPrices: new Set([1, 2, 3, 4]),
  selectedCuisines: new Set(),
  map: null,
  markers: [],
  infoWindow: null,
  searchController: null,
  currentTab: 'list',
  searching: false
};

// ============ INIT ============
function init() {
  loadFavorites();
  updateFavoriteCount();

  const d = new Date();
  const dateStr = d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).toUpperCase();
  document.getElementById('dateline').textContent = `— ${dateStr} —`;

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

  document.querySelectorAll('#pricePills .pill').forEach(pill => {
    pill.setAttribute('aria-pressed', 'true');
    pill.addEventListener('click', () => {
      togglePriceFilter(pill);
    });
  });

  const openNowOnly = document.getElementById('openNowOnly');
  openNowOnly.checked = false;
  openNowOnly.disabled = true;
  openNowOnly.closest('.toggle-row').classList.add('is-disabled');
  openNowOnly.closest('.toggle-row').title =
    'Open-now filtering is coming in a later version.';

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
    () => {
      showError('Location access denied. Try entering it manually.');
      btn.textContent = '⊙';
      btn.disabled = false;
    },
    { timeout: 10000, enableHighAccuracy: true }
  );
}

// ============ API ============
async function getAppConfig(signal) {
  if (state.config) return state.config;
  const res = await fetch('/api/config', {
    headers: { 'Accept': 'application/json' },
    signal
  });
  const data = await readJsonResponse(res);
  if (!res.ok) throw new Error(data.error || 'App configuration failed.');
  state.config = data;
  return data;
}

async function geocode(query, signal) {
  const url = `/api/geocode?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal
  });
  const data = await readJsonResponse(res);
  if (!res.ok) throw new Error(data.error || 'Location not found.');
  return data;
}

async function fetchPlaces(payload, signal) {
  updateSearchStatus('Looking for nearby food spots…');
  const res = await fetch('/api/places', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal
  });
  const data = await readJsonResponse(res);
  if (!res.ok) throw new Error(data.error || 'Food spot search failed.');
  return data;
}

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    if (res.status === 404) {
      return { error: 'Backend API not found. Run the app with Vercel so serverless functions are available.' };
    }
    return { error: 'Unexpected response from the app backend.' };
  }
}

// ============ GOOGLE MAPS ============
function ensureGoogleMaps(signal) {
  if (window.google && window.google.maps && window.google.maps.Map) {
    return Promise.resolve();
  }
  if (googleMapsLoadPromise) return googleMapsLoadPromise;

  googleMapsLoadPromise = getAppConfig(signal).then(config => {
    if (!config.mapsApiKey) {
      throw new Error('Google Maps browser key is not configured.');
    }

    return new Promise((resolve, reject) => {
      const callbackName = `forkwardGoogleMapsReady_${Date.now()}`;
      const script = document.createElement('script');
      const cleanup = () => {
        delete window[callbackName];
      };

      window[callbackName] = () => {
        cleanup();
        resolve();
      };

      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.mapsApiKey)}&loading=async&callback=${callbackName}`;
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        cleanup();
        googleMapsLoadPromise = null;
        reject(new Error('Google Maps could not load.'));
      };
      document.head.appendChild(script);
    });
  });

  return googleMapsLoadPromise;
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
    if (locInput && !isCoordinateInput(locInput)) {
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
    } else if (isCoordinateInput(locInput)) {
      const [lat, lon] = locInput.split(',').map(s => parseFloat(s.trim()));
      state.lat = lat;
      state.lon = lon;
      state.lastGeocodedInput = '';
      state.lastGeocodedCoords = null;
    }

    if (state.lat === null || state.lon === null) throw new Error('Could not determine location.');

    const radiusKm = getDistanceKm();
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
      throw new Error('Choose a valid distance.');
    }

    const data = await fetchPlaces({
      lat: state.lat,
      lon: state.lon,
      radiusKm,
      cuisines: [...state.selectedCuisines]
    }, state.searchController.signal);

    state.results = normalizeClientResults(data.places || []);
    state.requestedRadiusKm = data.requestedRadiusKm || radiusKm;
    state.searchRadiusKm = data.searchRadiusKm || radiusKm;
    state.searchExpanded = data.expandedRadius === true;
    state.relaxedTypes = data.relaxedTypes === true;
    state.resultNotice = buildSearchNotice(data);
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
        state.resultNotice = 'Showing your previous results while the latest search recovers.';
        renderResults();
      } else {
        showIdleStatus('Search could not finish', 'Try again in a moment, or check the Google API keys in Vercel.');
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

function isCoordinateInput(value) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(value);
}

function normalizeClientResults(results) {
  return results
    .map(r => ({
      ...r,
      lat: Number(r.lat),
      lon: Number(r.lon),
      distance: Number(r.distance),
      price: clampPrice(r.price),
      cuisines: Array.isArray(r.cuisines) && r.cuisines.length ? r.cuisines : ['Restaurant'],
      isOpen: null
    }))
    .filter(r =>
      r.id
      && r.name
      && Number.isFinite(r.lat)
      && Number.isFinite(r.lon)
      && Number.isFinite(r.distance)
    );
}

function clampPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) return 2;
  return Math.min(4, Math.max(1, Math.round(price)));
}

function buildSearchNotice(data) {
  const messages = [];
  if (data.relaxedTypes) {
    messages.push('No exact cuisine matches were nearby, so these are the closest food spots found.');
  }
  if (data.expandedRadius) {
    messages.push(`No matches appeared within ${Number(data.requestedRadiusKm).toFixed(1)} km, so the search expanded to ${Number(data.searchRadiusKm).toFixed(1)} km.`);
  }
  if (data.maxResultCount) {
    messages.push('Showing a short list of nearby choices.');
  }
  return messages.join(' ');
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
  const radiusKm = getDistanceLimitKm();
  state.filteredResults = state.results.filter(r => {
    if (Number.isFinite(radiusKm) && r.distance > radiusKm) return false;
    if (!state.selectedPrices.has(r.price)) return false;
    if (!state.relaxedTypes && state.selectedCuisines.size > 0) {
      const matches = r.cuisines.some(c => state.selectedCuisines.has(c));
      if (!matches) return false;
    }
    return true;
  });
}

function getDistanceLimitKm() {
  const selectedRadiusKm = getDistanceKm();
  if (state.searchExpanded && state.searchRadiusKm !== null) {
    return Math.max(selectedRadiusKm, state.searchRadiusKm);
  }
  return selectedRadiusKm;
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
    + `${state.resultNotice ? resultNoticeHTML(state.resultNotice) : ''}`
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
  if (!state.searchExpanded && state.searchRadiusKm !== null && radiusKm > state.searchRadiusKm) {
    return `Showing matches from the last ${state.searchRadiusKm.toFixed(1)} km search. Run search again to expand to ${radiusKm.toFixed(1)} km.`;
  }
  return '';
}

function cardHTML(r) {
  const isFav = state.favorites.some(f => f.id === r.id);
  const priceStr = '£'.repeat(r.price);
  const distStr = formatDistance(r.distance);
  const directionsUrl = getDirectionsUrl(r);
  const websiteUrl = safeHttpUrl(r.website);
  const moreUrl = safeHttpUrl(r.googleMapsUri) || directionsUrl;

  return `
    <article class="card" data-id="${escapeAttr(r.id)}">
      <div class="card-header">
        <h3>${escapeHtml(r.name)}</h3>
        <button class="fav-btn ${isFav ? 'active' : ''}" data-id="${escapeAttr(r.id)}" title="${isFav ? 'Remove from favourites' : 'Save to favourites'}">★</button>
      </div>
      <div class="cuisine-tag">${escapeHtml(r.cuisines.join(' · '))}</div>
      <div class="card-meta">
        <span class="price">${priceStr}</span>
        <span>· ${distStr}</span>
      </div>
      <div class="address">${escapeHtml(r.address || 'Address unavailable')}</div>
      <div class="card-footer">
        <a class="mini-btn" href="${escapeAttr(directionsUrl)}" target="_blank" rel="noopener">↗ Directions</a>
        ${websiteUrl ? `<a class="mini-btn" href="${escapeAttr(websiteUrl)}" target="_blank" rel="noopener">⌘ Website</a>` : ''}
        <a class="mini-btn" href="${escapeAttr(moreUrl)}" target="_blank" rel="noopener">ⓘ Maps</a>
      </div>
    </article>
  `;
}

function getDirectionsUrl(r) {
  if (r.googlePlaceId) {
    const destination = encodeURIComponent(r.name || `${r.lat},${r.lon}`);
    return `https://www.google.com/maps/dir/?api=1&destination=${destination}&destination_place_id=${encodeURIComponent(r.googlePlaceId)}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}`;
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
async function renderMap(options = {}) {
  const preserveView = options.preserveView === true;
  const mapEl = document.getElementById('map');

  try {
    await ensureGoogleMaps();
  } catch (err) {
    mapEl.innerHTML = mapStatusHTML(
      'Google Maps is not ready',
      err.message || 'Check the browser API key in Vercel.'
    );
    return;
  }

  const center = getMapCenter();
  if (!state.map) {
    state.map = new google.maps.Map(mapEl, {
      center,
      zoom: 14,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true
    });
    state.infoWindow = new google.maps.InfoWindow();
  } else if (!preserveView) {
    state.map.setCenter(center);
    state.map.setZoom(14);
  }

  clearMapMarkers();
  const bounds = new google.maps.LatLngBounds();
  let boundsCount = 0;

  if (state.lat !== null && state.lon !== null) {
    const userMarker = new google.maps.Marker({
      position: center,
      map: state.map,
      title: 'You are here',
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: '#1a1612',
        fillOpacity: 1,
        strokeColor: '#d2391e',
        strokeWeight: 3
      }
    });
    state.markers.push(userMarker);
    bounds.extend(center);
    boundsCount += 1;
  }

  state.filteredResults.forEach(r => {
    const marker = createPlaceMarker(r);
    state.markers.push(marker);
    bounds.extend({ lat: r.lat, lng: r.lon });
    boundsCount += 1;
  });

  if (!preserveView && boundsCount > 1) {
    state.map.fitBounds(bounds, 48);
    google.maps.event.addListenerOnce(state.map, 'bounds_changed', () => {
      if (state.map.getZoom() > 16) state.map.setZoom(16);
    });
  }
}

function getMapCenter() {
  return {
    lat: state.lat !== null ? state.lat : DEFAULT_MAP_CENTER.lat,
    lng: state.lon !== null ? state.lon : DEFAULT_MAP_CENTER.lng
  };
}

function clearMapMarkers() {
  state.markers.forEach(marker => marker.setMap(null));
  state.markers = [];
}

function createPlaceMarker(r) {
  const marker = new google.maps.Marker({
    position: { lat: r.lat, lng: r.lon },
    map: state.map,
    title: r.name,
    label: {
      text: '£'.repeat(r.price),
      color: '#1a1612',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '11px',
      fontWeight: '700'
    }
  });
  marker.addListener('click', () => {
    state.infoWindow.setContent(placePopupHTML(r));
    state.infoWindow.open({ anchor: marker, map: state.map });
  });
  return marker;
}

function placePopupHTML(r) {
  const moreUrl = safeHttpUrl(r.googleMapsUri) || getDirectionsUrl(r);
  return `
    <div class="map-popup">
      <h4><a href="${escapeAttr(moreUrl)}" target="_blank" rel="noopener">${escapeHtml(r.name)}</a></h4>
      <p>${escapeHtml(r.cuisines.join(' · '))}</p>
      <p>${'£'.repeat(r.price)} · ${formatDistance(r.distance)}</p>
    </div>
  `;
}

function mapStatusHTML(title, message) {
  return `
    <div class="status map-status">
      <div class="ornament">◇</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
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
    }, 50);
  }
  if (tab === 'favorites') renderFavorites();
}

// ============ STATUS / ERROR ============
function showLoading() {
  if (state.filteredResults.length) {
    state.resultNotice = 'Refreshing nearby food spots…';
    renderResults();
    return;
  }

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
  const box = document.getElementById('errorBox');
  box.style.display = 'none';
  box.textContent = '';
}

// ============ GO ============
init();
