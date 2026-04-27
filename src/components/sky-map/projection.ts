/** Stereographic projection math — ported from Python DeepSkySurveyMap */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export interface ProjCenter {
  ra0: number;   // radians
  dec0: number;  // radians
  sin0: number;
  cos0: number;
}

export function makeCenter(raDeg: number, decDeg: number): ProjCenter {
  const ra0 = raDeg * DEG2RAD;
  const dec0 = decDeg * DEG2RAD;
  return { ra0, dec0, sin0: Math.sin(dec0), cos0: Math.cos(dec0) };
}

/** Forward stereographic: (RA°, Dec°) → (x, y, cos_c) on unit sphere */
export function stereoFwd(
  raDeg: number, decDeg: number, c: ProjCenter
): [number, number, number] {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const dra = ra - c.ra0;
  const cosDec = Math.cos(dec);
  const sinDec = Math.sin(dec);
  const cosDra = Math.cos(dra);
  const cosC = c.sin0 * sinDec + c.cos0 * cosDec * cosDra;
  if (cosC < -0.9999) return [0, 0, cosC];
  const k = 2 / (1 + cosC);
  const x = k * cosDec * Math.sin(dra);
  const y = k * (c.cos0 * sinDec - c.sin0 * cosDec * cosDra);
  return [x, y, cosC];
}

/** Inverse stereographic: projection-plane (x, y) → (RA°, Dec°) */
export function stereoInv(
  x: number, y: number, c: ProjCenter
): [number, number] {
  const rho = Math.sqrt(x * x + y * y);
  if (rho < 1e-12) return [((c.ra0 * RAD2DEG) % 360 + 360) % 360, c.dec0 * RAD2DEG];
  const cc = 2 * Math.atan2(rho, 2);
  const sinC = Math.sin(cc);
  const cosC = Math.cos(cc);
  const dec = Math.asin(
    Math.max(-1, Math.min(1, cosC * c.sin0 + (y * sinC * c.cos0) / rho))
  );
  const ra = c.ra0 + Math.atan2(x * sinC, rho * c.cos0 * cosC - y * c.sin0 * sinC);
  return [((ra * RAD2DEG) % 360 + 360) % 360, dec * RAD2DEG];
}

/** Compute scale: pixels per unit projection coord */
export function computeScale(widthPx: number, fovDeg: number): number {
  const fovRad = Math.max(fovDeg, 0.01) * DEG2RAD;
  return widthPx / (4 * Math.tan(fovRad / 4));
}

/* ── Galactic ↔ Equatorial conversion (IAU 2000, J2000) ── */
const _RA_GP  = 192.85948 * DEG2RAD;
const _DEC_GP = 27.12825  * DEG2RAD;
const _L_NCP  = 122.93192 * DEG2RAD;
const _SIN_DG = Math.sin(_DEC_GP);
const _COS_DG = Math.cos(_DEC_GP);

/** Equatorial (RA°, Dec°) → Galactic (l°, b°) */
export function eqToGal(raDeg: number, decDeg: number): [number, number] {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const sinDec = Math.sin(dec);
  const cosDec = Math.cos(dec);
  const dra = ra - _RA_GP;
  const sinB = sinDec * _SIN_DG + cosDec * _COS_DG * Math.cos(dra);
  const b = Math.asin(Math.max(-1, Math.min(1, sinB)));
  const y = cosDec * Math.sin(dra);
  const x = sinDec * _COS_DG - cosDec * _SIN_DG * Math.cos(dra);
  const l = ((_L_NCP - Math.atan2(y, x)) * RAD2DEG % 360 + 360) % 360;
  return [l, b * RAD2DEG];
}

/** Galactic (l°, b°) → Equatorial (RA°, Dec°) */
export function galToEq(lDeg: number, bDeg: number): [number, number] {
  const l = lDeg * DEG2RAD;
  const b = bDeg * DEG2RAD;
  const sinB = Math.sin(b);
  const cosB = Math.cos(b);
  const dl = l - _L_NCP;
  const sinDec = sinB * _SIN_DG + cosB * _COS_DG * Math.cos(dl);
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));
  const y = cosB * Math.sin(dl);
  const x = sinB * _COS_DG - cosB * _SIN_DG * Math.cos(dl);
  const ra = ((_RA_GP + Math.atan2(y, x)) * RAD2DEG % 360 + 360) % 360;
  return [ra, dec * RAD2DEG];
}
