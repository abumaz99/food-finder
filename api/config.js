const { sendJson } = require('./_google');

module.exports = async function config(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed. Use GET.' });
    return;
  }

  sendJson(res, 200, {
    mapsApiKey: process.env.GOOGLE_MAPS_BROWSER_KEY || '',
    provider: 'google'
  }, 'public, max-age=300, s-maxage=300');
};
