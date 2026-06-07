const {
  DEFAULT_FOOD_TYPES,
  badRequest,
  clampRadiusMeters,
  cleanCoordinate,
  getIncludedTypes,
  getServerKey,
  methodNotAllowed,
  missingServerKey,
  normalizePlace,
  readJsonBody,
  searchNearby,
  sendJson
} = require('./_google');

module.exports = async function places(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return;
  }

  const apiKey = getServerKey();
  if (!apiKey) {
    missingServerKey(res);
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (_) {
    badRequest(res, 'Invalid JSON body.');
    return;
  }

  const lat = cleanCoordinate(body.lat);
  const lon = cleanCoordinate(body.lon);
  if (lat === null || lon === null) {
    badRequest(res, 'A valid latitude and longitude are required.');
    return;
  }

  const requestedRadiusMeters = clampRadiusMeters(body.radiusKm);
  const selectedTypes = getIncludedTypes(body.cuisines);
  const hasCuisineFilter = Array.isArray(body.cuisines) && body.cuisines.length > 0;
  const center = { lat, lon };

  try {
    let radiusMeters = requestedRadiusMeters;
    let relaxedTypes = false;
    let expandedRadius = false;
    let includedTypes = selectedTypes;
    let data = await searchNearby({ lat, lon, radiusMeters, includedTypes, apiKey });
    let places = normalizePlaces(data, center);

    if (!places.length && hasCuisineFilter) {
      relaxedTypes = true;
      includedTypes = DEFAULT_FOOD_TYPES;
      data = await searchNearby({ lat, lon, radiusMeters, includedTypes, apiKey });
      places = normalizePlaces(data, center);
    }

    if (!places.length && radiusMeters < 5000) {
      expandedRadius = true;
      relaxedTypes = relaxedTypes || hasCuisineFilter;
      radiusMeters = Math.min(5000, Math.max(radiusMeters * 3, 1500));
      includedTypes = DEFAULT_FOOD_TYPES;
      data = await searchNearby({ lat, lon, radiusMeters, includedTypes, apiKey });
      places = normalizePlaces(data, center);
    }

    sendJson(res, 200, {
      places,
      requestedRadiusKm: requestedRadiusMeters / 1000,
      searchRadiusKm: radiusMeters / 1000,
      expandedRadius,
      relaxedTypes,
      maxResultCount: 20
    });
  } catch (err) {
    sendJson(res, err.status || 502, {
      error: err.status === 504
        ? 'Food spot search timed out.'
        : 'Food spot search failed.'
    });
  }
};

function normalizePlaces(data, center) {
  return (data.places || [])
    .filter(place => place.businessStatus !== 'CLOSED_PERMANENTLY')
    .map(place => normalizePlace(place, center))
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);
}
