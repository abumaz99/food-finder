/**
 * Utility functions: distance calculation, opening-hours parsing,
 * HTML escaping. Kept stateless and dependency-free.
 */

/** Great-circle distance between two coords, in kilometres. */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Lightweight OSM `opening_hours` parser.
 * Handles common patterns (e.g. "Mo-Fr 09:00-17:00; Sa,Su 10:00-14:00").
 * Returns true / false / null (null = unparseable).
 */
function checkOpenNow(hoursStr) {
  try {
    const now = new Date();
    const dayMap = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const today = dayMap[now.getDay()];
    const minutes = now.getHours() * 60 + now.getMinutes();

    if (/24\/7/i.test(hoursStr)) return true;

    const rules = hoursStr.split(';').map(s => s.trim());

    for (const rule of rules) {
      const m = rule.match(/^([A-Za-z,\-\s]+)\s+([\d:,\s\-]+)$/);
      if (!m) {
        if (/^[\d:,\s\-]+$/.test(rule) && timeMatches(rule, minutes)) return true;
        continue;
      }
      const daySpec = m[1].trim();
      const timeSpec = m[2].trim();
      if (dayInSpec(today, daySpec, dayMap) && timeMatches(timeSpec, minutes)) {
        return true;
      }
    }
    return false;
  } catch (e) {
    return null;
  }
}

function dayInSpec(today, spec, dayMap) {
  const parts = spec.split(',').map(s => s.trim());
  for (const part of parts) {
    if (part === today) return true;
    const range = part.match(/^([A-Za-z]{2})-([A-Za-z]{2})$/);
    if (range) {
      const start = dayMap.indexOf(range[1]);
      const end   = dayMap.indexOf(range[2]);
      const idx   = dayMap.indexOf(today);
      if (start === -1 || end === -1) continue;
      if (start <= end) {
        if (idx >= start && idx <= end) return true;
      } else {
        // wrap around midnight
        if (idx >= start || idx <= end) return true;
      }
    }
  }
  return false;
}

function timeMatches(spec, minutes) {
  const ranges = spec.split(',').map(s => s.trim());
  for (const r of ranges) {
    const m = r.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const start = parseInt(m[1]) * 60 + parseInt(m[2]);
    let end     = parseInt(m[3]) * 60 + parseInt(m[4]);
    if (end <= start) end += 24 * 60; // overnight
    if (minutes >= start && minutes <= end) return true;
    if (minutes + 24 * 60 >= start && minutes + 24 * 60 <= end) return true;
  }
  return false;
}

/** Escape user/API content before injecting into HTML. */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const escapeAttr = escapeHtml;
