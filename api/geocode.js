const {
  GEOCODE_TIMEOUT_MS,
  badRequest,
  fetchJson,
  getServerKey,
  methodNotAllowed,
  missingServerKey,
  sendJson
} = require('./_google');

module.exports = async function geocode(req, res) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET']);
    return;
  }

  const apiKey = getServerKey();
  if (!apiKey) {
    missingServerKey(res);
    return;
  }

  const requestUrl = new URL(req.url || '', 'http://localhost');
  const query = String(req.query?.query || requestUrl.searchParams.get('query') || '').trim();
  if (!query) {
    badRequest(res, 'Enter a location to search.');
    return;
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', query);
    url.searchParams.set('key', apiKey);

    const data = await fetchJson(url, { method: 'GET' }, GEOCODE_TIMEOUT_MS);
    if (data.status === 'ZERO_RESULTS') {
      sendJson(res, 404, { error: 'Location not found.' });
      return;
    }

    if (data.status !== 'OK' || !Array.isArray(data.results) || !data.results.length) {
      sendJson(res, 502, { error: 'Google Geocoding API rejected the request.' });
      return;
    }

    const first = data.results[0];
    sendJson(res, 200, {
      lat: first.geometry.location.lat,
      lon: first.geometry.location.lng,
      display: first.formatted_address
    });
  } catch (err) {
    sendJson(res, err.status || 502, {
      error: err.status === 504 ? 'Location lookup timed out.' : 'Location lookup failed.'
    });
  }
};
