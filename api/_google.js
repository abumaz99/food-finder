const SERVER_KEY_ENV = 'GOOGLE_MAPS_SERVER_KEY';
const PLACES_TIMEOUT_MS = 7000;
const GEOCODE_TIMEOUT_MS = 6000;
const MAX_RESULT_COUNT = 20;
const MAX_RADIUS_METERS = 10000;
const DEFAULT_RADIUS_METERS = 1500;

const DEFAULT_FOOD_TYPES = [
  'restaurant',
  'cafe',
  'bar',
  'pub',
  'bakery',
  'meal_takeaway',
  'fast_food_restaurant',
  'coffee_shop',
  'breakfast_restaurant',
  'brunch_restaurant',
  'dessert_shop',
  'ice_cream_shop',
  'food_court'
];

const CUISINE_TYPE_MAP = {
  Italian: ['italian_restaurant', 'pizza_restaurant'],
  French: ['french_restaurant', 'bistro'],
  Spanish: ['spanish_restaurant', 'tapas_restaurant'],
  Greek: ['greek_restaurant'],
  Japanese: ['japanese_restaurant', 'sushi_restaurant', 'ramen_restaurant', 'japanese_curry_restaurant'],
  Chinese: ['chinese_restaurant', 'chinese_noodle_restaurant', 'dim_sum_restaurant'],
  Thai: ['thai_restaurant'],
  Indian: ['indian_restaurant', 'north_indian_restaurant', 'south_indian_restaurant'],
  Vietnamese: ['vietnamese_restaurant'],
  Korean: ['korean_restaurant', 'korean_barbecue_restaurant'],
  Mexican: ['mexican_restaurant', 'taco_restaurant', 'burrito_restaurant', 'tex_mex_restaurant'],
  'Middle Eastern': [
    'middle_eastern_restaurant',
    'mediterranean_restaurant',
    'lebanese_restaurant',
    'turkish_restaurant',
    'kebab_shop',
    'falafel_restaurant',
    'halal_restaurant'
  ],
  American: ['american_restaurant', 'hamburger_restaurant', 'steak_house', 'barbecue_restaurant'],
  Seafood: ['seafood_restaurant', 'fish_and_chips_restaurant', 'oyster_bar_restaurant'],
  Vegetarian: ['vegetarian_restaurant', 'vegan_restaurant', 'salad_shop'],
  'Café / Brunch': ['cafe', 'coffee_shop', 'breakfast_restaurant', 'brunch_restaurant', 'bagel_shop'],
  'Bakery / Sweets': ['bakery', 'dessert_shop', 'dessert_restaurant', 'ice_cream_shop', 'cake_shop', 'pastry_shop'],
  'Pub / Bar': ['pub', 'bar', 'bar_and_grill', 'gastropub', 'sports_bar', 'wine_bar', 'cocktail_bar']
};

const CUISINE_LABELS = Object.keys(CUISINE_TYPE_MAP);

function getServerKey() {
  return process.env[SERVER_KEY_ENV] || '';
}

function sendJson(res, statusCode, body, cacheControl = 'no-store') {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.end(JSON.stringify(body));
}

function methodNotAllowed(res, allowedMethods) {
  res.setHeader('Allow', allowedMethods.join(', '));
  sendJson(res, 405, { error: `Method not allowed. Use ${allowedMethods.join(' or ')}.` });
}

function badRequest(res, message) {
  sendJson(res, 400, { error: message });
}

function missingServerKey(res) {
  sendJson(res, 500, {
    error: `Missing ${SERVER_KEY_ENV}. Add it in Vercel Environment Variables.`
  });
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = {};
    }
    if (!res.ok) {
      const err = new Error(data.error?.message || `Google returned ${res.status}`);
      err.status = res.status;
      err.details = data;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeout = new Error('Google request timed out');
      timeout.status = 504;
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function clampRadiusMeters(radiusKm) {
  const requested = Number(radiusKm) * 1000;
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_RADIUS_METERS;
  return Math.min(MAX_RADIUS_METERS, Math.max(300, Math.round(requested)));
}

function cleanCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getIncludedTypes(cuisines) {
  if (!Array.isArray(cuisines) || cuisines.length === 0) return [...DEFAULT_FOOD_TYPES];

  const types = [];
  cuisines.forEach(label => {
    const mapped = CUISINE_TYPE_MAP[label];
    if (mapped) types.push(...mapped);
  });

  return [...new Set(types)].slice(0, 50);
}

function typesToCuisineLabels(types = [], primaryType = '') {
  const allTypes = new Set([primaryType, ...types].filter(Boolean));
  const labels = CUISINE_LABELS.filter(label =>
    CUISINE_TYPE_MAP[label].some(type => allTypes.has(type))
  );

  if (labels.length) return labels;
  if (allTypes.has('cafe') || allTypes.has('coffee_shop')) return ['Café / Brunch'];
  if (allTypes.has('bakery')) return ['Bakery / Sweets'];
  if (allTypes.has('pub') || allTypes.has('bar')) return ['Pub / Bar'];
  return ['Restaurant'];
}

function inferPrice(types = [], primaryType = '', name = '') {
  const allTypes = new Set([primaryType, ...types].filter(Boolean));
  const lowerName = String(name).toLowerCase();

  if (
    allTypes.has('fast_food_restaurant')
    || allTypes.has('meal_takeaway')
    || allTypes.has('cafe')
    || allTypes.has('coffee_shop')
    || allTypes.has('bakery')
    || allTypes.has('sandwich_shop')
    || allTypes.has('ice_cream_shop')
  ) {
    return 1;
  }

  if (
    allTypes.has('fine_dining_restaurant')
    || /michelin|fine dining|tasting menu|omakase/.test(lowerName)
  ) {
    return 4;
  }

  if (allTypes.has('steak_house') || allTypes.has('seafood_restaurant')) return 3;
  return 2;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function googleMapsPlaceUrl(place, lat, lon) {
  if (place.googleMapsUri) return place.googleMapsUri;
  const query = encodeURIComponent(`${lat},${lon}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${encodeURIComponent(place.id)}`;
}

function normalizePlace(place, center) {
  const lat = cleanCoordinate(place.location?.latitude);
  const lon = cleanCoordinate(place.location?.longitude);
  if (lat === null || lon === null || !place.displayName?.text || !place.id) return null;

  const types = Array.isArray(place.types) ? place.types : [];
  const primaryType = place.primaryType || types[0] || 'restaurant';
  const name = place.displayName.text;

  return {
    id: `google:${place.id}`,
    googlePlaceId: place.id,
    source: 'google',
    name,
    lat,
    lon,
    distance: haversine(center.lat, center.lon, lat, lon),
    cuisines: typesToCuisineLabels(types, primaryType),
    price: inferPrice(types, primaryType, name),
    address: place.formattedAddress || 'Address unavailable',
    phone: null,
    website: null,
    isOpen: null,
    primaryType,
    types,
    businessStatus: place.businessStatus || null,
    googleMapsUri: googleMapsPlaceUrl(place, lat, lon)
  };
}

async function searchNearby({ lat, lon, radiusMeters, includedTypes, apiKey }) {
  const body = {
    includedTypes,
    maxResultCount: MAX_RESULT_COUNT,
    rankPreference: 'DISTANCE',
    locationRestriction: {
      circle: {
        center: {
          latitude: lat,
          longitude: lon
        },
        radius: radiusMeters
      }
    }
  };

  return fetchJson('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.primaryType',
        'places.types',
        'places.businessStatus',
        'places.googleMapsUri'
      ].join(',')
    },
    body: JSON.stringify(body)
  }, PLACES_TIMEOUT_MS);
}

module.exports = {
  SERVER_KEY_ENV,
  GEOCODE_TIMEOUT_MS,
  DEFAULT_FOOD_TYPES,
  badRequest,
  clampRadiusMeters,
  cleanCoordinate,
  fetchJson,
  getIncludedTypes,
  getServerKey,
  methodNotAllowed,
  missingServerKey,
  normalizePlace,
  readJsonBody,
  searchNearby,
  sendJson
};
