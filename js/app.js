/**
 * Forkward — Holiday Food Finder
 * Main application logic: state, data fetching, rendering, map.
 */

// ============ STATE ============
const state = {
  lat: null,
  lon: null,
  locationLabel: '',
  results: [],
  filteredResults: [],
  favorites: [],
  selectedPrices: new Set([1, 2, 3, 4]),
  selectedCuisines: new Set(),
  map: null,
  markers: [],
  currentTab: 'list'
};

// ============ INIT ============
function init() {
  // Date in masthead
  const d = new Date();
  const dateStr = d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).toUpperCase();
  document.getElementById('dateline').textContent = `— ${dateStr} —`;

  // Cuisine pills
  const cuisinePills = document.getElementById('cuisinePills');
  Object.keys(CUISINES).forEach(cuisine => {
    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.textContent = cuisine;
    pill.dataset.cuisine = cuisine;
    pill.addEventListener('click', () => {
      pill.classList.toggle('active');
      if (pill.classList.contains('active')) {
        state.selectedCuisines.add(cuisine);
      } else {
        state.selectedCuisines.delete(cuisine);
      }
    });
    cuisinePills.appendChild(pill);
  });

  // Price pills
  document.querySelectorAll('#pricePills .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const price = parseInt(pill.dataset.price);
      pill.classList.toggle('active');
      if (pill.classList.contains('active')) {
        state.selectedPrices.add(price);
      } else {
        state.selectedPrices.delete(price);
      }
    });
  });

  // Distance display
  const distanceInput = document.getElementById('distance');
  const distanceVal = document.getElementById('distanceVal');
  distanceInput.addEventListener('input', () => {
    distanceVal.textContent = `${parseFloat(distanceInput.value).toFixed(1)} km`;
  });

  document.getElementById('gpsBtn').addEventListener('click', useGPS);
  document.getElementById('searchBtn').addEventListener('click', search);
  document.getElementById('surpriseBtn').addEventListener('click', surpriseMe);

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  document.getElementById('sortBy').addEventListener('change', () => sortAndRender());

  document.getElementById('openNowOnly').addEventListener('change', () => {
    if (state.results.length) {
      applyFilters();
      sortAndRender();
    }
  });

  document.getElementById('surpriseAgain').addEventListener('click', surpriseMe);
  document.getElementById('surpriseClose').addEventListener('click', () => {
    document.getElementById('surpriseBox').classList.remove('visible');
  });
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
async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('Geocoding failed');
  const data = await res.json();
  if (!data.length) throw new Error('Location not found');
  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    display: data[0].display_name
  };
}

// ============ OVERPASS FETCH ============
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

async function fetchOverpass(query) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (res.ok) return res.json();
    } catch (_) {
      clearTimeout(timer);
      // network error or timeout — try next endpoint
    }
  }
  throw new Error('Could not reach Overpass API — try again shortly');
}

// ============ SEARCH ============
async function search() {
  hideError();
  const locInput = document.getElementById('location').value.trim();
  if (!locInput && state.lat === null) {
    showError('Please enter a location or use GPS.');
    return;
  }

  showLoading();

  try {
    if (locInput && !locInput.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/)) {
      const geo = await geocode(locInput);
      state.lat = geo.lat;
      state.lon = geo.lon;
      state.locationLabel = geo.display.split(',')[0];
    } else if (locInput.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/)) {
      const [lat, lon] = locInput.split(',').map(s => parseFloat(s.trim()));
      state.lat = lat;
      state.lon = lon;
    }

    if (!state.lat) throw new Error('Could not determine location');

    const radius = parseFloat(document.getElementById('distance').value) * 1000;
    const q = `[out:json][timeout:15];
(
  node["amenity"~"^(restaurant|cafe|pub|bar|fast_food)$"](around:${radius},${state.lat},${state.lon});
  way["amenity"~"^(restaurant|cafe|pub|bar|fast_food)$"](around:${radius},${state.lat},${state.lon});
);
out center qt tags 150;`;

    const data = await fetchOverpass(q);

    state.results = data.elements
      .map(el => parseElement(el))
      .filter(r => r && r.name);

    applyFilters();
    sortAndRender();
  } catch (err) {
    showError('Search failed: ' + err.message);
    document.getElementById('initialStatus').style.display = 'block';
    document.getElementById('resultsContent').style.display = 'none';
  }
}

// ============ PARSE OSM ELEMENT ============
function parseElement(el) {
  const tags = el.tags || {};
  if (!tags.name) return null;

  const lat = el.lat || (el.center && el.center.lat);
  const lon = el.lon || (el.center && el.center.lon);
  if (!lat || !lon) return null;

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
function applyFilters() {
  const openNowOnly = document.getElementById('openNowOnly').checked;
  state.filteredResults = state.results.filter(r => {
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

  grid.innerHTML = state.filteredResults.map(r => cardHTML(r)).join('');

  grid.querySelectorAll('.fav-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleFavorite(btn.dataset.id);
    });
  });
}

function cardHTML(r) {
  const isFav = state.favorites.some(f => f.id === r.id);
  const priceStr = '£'.repeat(r.price);
  const distStr = r.distance < 1
    ? `${Math.round(r.distance * 1000)} m`
    : `${r.distance.toFixed(1)} km`;
  let openTag = '';
  if      (r.isOpen === true)  openTag = '<span class="open-now">● Open now</span>';
  else if (r.isOpen === false) openTag = '<span class="closed-now">● Closed</span>';

  const osmUrl = `https://www.openstreetmap.org/${r.osmType}/${r.osmId}`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}`;

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
        ${r.website ? `<a class="mini-btn" href="${escapeAttr(r.website)}" target="_blank" rel="noopener">⌘ Website</a>` : ''}
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

  document.getElementById('favCount').textContent = state.favorites.length;
  renderResults();
  renderFavorites();
}

function renderFavorites() {
  const status = document.getElementById('favStatus');
  const grid = document.getElementById('favGrid');
  if (!state.favorites.length) {
    status.style.display = 'block';
    grid.style.display = 'none';
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
function renderMap() {
  if (!state.map) {
    state.map = L.map('map').setView([state.lat || 51.5, state.lon || -0.1], 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(state.map);
  } else {
    if (state.lat) state.map.setView([state.lat, state.lon], 14);
    state.markers.forEach(m => state.map.removeLayer(m));
    state.markers = [];
  }

  if (state.lat) {
    const userIcon = L.divIcon({
      className: '',
      html: `<div style="width:18px;height:18px;border-radius:50%;background:#1a1612;border:3px solid #d2391e;box-shadow:0 0 0 4px rgba(210,57,30,0.25);"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
    const m = L.marker([state.lat, state.lon], { icon: userIcon }).addTo(state.map);
    m.bindPopup('<strong>You are here</strong>');
    state.markers.push(m);
  }

  state.filteredResults.forEach(r => {
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:24px;height:24px;border-radius:50%;background:#fbf6e9;border:2px solid #1a1612;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:#1a1612;box-shadow:2px 2px 0 #1a1612;">${'£'.repeat(r.price)}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    const marker = L.marker([r.lat, r.lon], { icon }).addTo(state.map);
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(r.name + ' ' + r.address)}`;
    marker.bindPopup(`
      <div class="map-popup">
        <h4><a href="${searchUrl}" target="_blank" rel="noopener">${escapeHtml(r.name)}</a></h4>
        <p>${escapeHtml(r.cuisines.join(' · '))}</p>
        <p>${'£'.repeat(r.price)} · ${r.distance < 1 ? Math.round(r.distance * 1000) + ' m' : r.distance.toFixed(1) + ' km'}</p>
      </div>
    `);
    state.markers.push(marker);
  });
}

// ============ SURPRISE ============
function surpriseMe() {
  if (!state.filteredResults.length) {
    showError('Run a search first, then I can pick.');
    return;
  }
  const r = state.filteredResults[Math.floor(Math.random() * state.filteredResults.length)];
  document.getElementById('surpriseMeta').textContent =
    `${'£'.repeat(r.price)} · ${r.cuisines[0]} · ${r.distance < 1 ? Math.round(r.distance * 1000) + ' m' : r.distance.toFixed(1) + ' km away'}`;
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
    <p>Sifting through the neighbourhood for places worth eating.</p>
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
