// Solposisjon (NOAA-forenkling) for Hellesmoveien 33, Tjøme.
const LAT = 59.0655, LON = 10.4046;
const rad = Math.PI / 180;

function lastSunday(year, month) {
  const d = new Date(Date.UTC(year, month + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

// month 0-11, day 1-31, hour lokal tid (desimal)
export function sunPosition(month, day, hour, year = 2026) {
  const dstStart = lastSunday(year, 2), dstEnd = lastSunday(year, 9);
  const dateUTC = Date.UTC(year, month, day);
  const offset = dateUTC >= dstStart.getTime() && dateUTC < dstEnd.getTime() ? 2 : 1;
  const utc = hour - offset;
  const start = Date.UTC(year, 0, 1);
  const doy = Math.floor((dateUTC - start) / 86400000) + 1;
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (utc - 12) / 24);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = utc * 60 + eqtime + 4 * LON;
  const ha = (tst / 4 - 180) * rad;
  const lat = LAT * rad;
  const cosZ = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  const elev = 90 - zen / rad;
  let az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(lat) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(lat) * Math.sin(zen))))) / rad;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360; // fra nord, med klokka
  return { elevation: elev, azimuth: az };
}

// Enhetsvektor i three.js (X=øst, Y=opp, Z=-nord)
export function sunVector(month, day, hour) {
  const { elevation, azimuth } = sunPosition(month, day, hour);
  const e = elevation * rad, a = azimuth * rad;
  return { x: Math.cos(e) * Math.sin(a), y: Math.sin(e), z: -Math.cos(e) * Math.cos(a), elevation, azimuth };
}

export function sunTimes(month, day) {
  let rise = null, set = null, prev = sunPosition(month, day, 0).elevation;
  for (let h = 0.05; h <= 24; h += 0.05) {
    const e = sunPosition(month, day, h).elevation;
    if (prev < -0.83 && e >= -0.83 && rise === null) rise = h;
    if (prev >= -0.83 && e < -0.83) set = h;
    prev = e;
  }
  return { rise, set };
}
