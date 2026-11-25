// Regenerates components/geo-world.js — the vendored world geometry behind
// chart kind "map". Build-time only: the assembled page never runs any of
// the packages below; it gets pre-projected SVG path strings plus a 20-line
// Equal Earth forward formula for placing point markers.
//
// Provenance: world-atlas countries-110m.json (Natural Earth 1:110m,
// public domain; the package itself is ISC © Michael Bostock), projected
// through Equal Earth at 960px wide with integer coordinates. Country ids
// are ISO 3166-1 alpha-3 and display names come from world-countries.
//
// To regenerate (needs node + network, neither of which the kit itself needs):
//   mkdir /tmp/geo && cd /tmp/geo
//   npm install world-atlas@2 topojson-client@3 d3-geo@3 world-countries@5
//   node <this-repo>/skills/explainer/vendor/make-geo-world.mjs
// The script verifies its runtime projection formula against d3-geo before
// writing, and prints the payload size — keep it under ~100 KB.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// packages resolve from the *current directory* (the scratch dir above),
// not from this repo — the kit deliberately has no node_modules
const require = createRequire(join(process.cwd(), 'x'));
const topojson = require('topojson-client');
const { geoEqualEarth, geoPath, geoGraticule } = require('d3-geo');
const countriesMeta = require('world-countries');
const topo = require('world-atlas/countries-110m.json');

const W = 960;
const fc = topojson.feature(topo, topo.objects.countries);
const proj = geoEqualEarth().fitWidth(W, { type: 'Sphere' });
const H = Math.ceil(geoPath(proj).bounds({ type: 'Sphere' })[1][1]);
const path = geoPath(proj).digits(0);

const byNumeric = new Map();
for (const c of countriesMeta) {
  if (c.ccn3) byNumeric.set(c.ccn3.padStart(3, '0'), { a3: c.cca3, name: c.name.common });
}

const countries = [];
for (const f of fc.features) {
  const id = f.id == null ? '' : String(f.id).padStart(3, '0');
  const meta = byNumeric.get(id);
  const d = path(f);
  if (!d) continue;
  const c = path.centroid(f).map((v) => Math.round(v * 10) / 10);
  const bb = path.bounds(f);
  countries.push({
    id: meta ? meta.a3 : '', // disputed territories (Kosovo, …) match by name only
    name: meta ? meta.name : f.properties.name,
    d,
    c,
    // on-screen size in viewBox units — the renderer marks countries too
    // small to carry a tone fill with a ring at the centroid instead
    b: [Math.round(bb[1][0] - bb[0][0]), Math.round(bb[1][1] - bb[0][1])],
  });
}

const sphere = path({ type: 'Sphere' });
const graticule = geoPath(proj).digits(0)(geoGraticule().step([30, 30])());
const k = Math.round(proj.scale() * 1e6) / 1e6;
const [tx, ty] = proj.translate().map((v) => Math.round(v * 1e6) / 1e6);

// the runtime formula must reproduce d3's screen coordinates exactly —
// otherwise point markers drift off their countries
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
function forward(lonDeg, latDeg) {
  const lon = (lonDeg * Math.PI) / 180, lat = (latDeg * Math.PI) / 180;
  const t = Math.asin(M * Math.sin(lat)), t2 = t * t, t6 = t2 * t2 * t2;
  const x = (lon * Math.cos(t)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [tx + k * x, ty - k * y];
}
for (const [lon, lat] of [[4.9, 52.37], [-74, 40.7], [151.2, -33.87], [0, 0], [-58.4, -34.6], [139.7, 35.7]]) {
  const [dx, dy] = proj([lon, lat]);
  const [mx, my] = forward(lon, lat);
  if (Math.abs(dx - mx) > 0.05 || Math.abs(dy - my) > 0.05) {
    throw new Error(`projection mismatch at ${lon},${lat}: d3=(${dx},${dy}) formula=(${mx},${my})`);
  }
}

const payload = { w: W, h: H, k, tx, ty, sphere, graticule, countries };
const js = `/* component: geo-world — vendored world geometry for chart kind "map".
   GENERATED FILE — do not edit by hand; regenerate with
   vendor/make-geo-world.mjs (instructions in its header).
   Source: world-atlas countries-110m (Natural Earth 1:110m, public domain;
   package ISC © Michael Bostock), pre-projected through Equal Earth at
   ${W}×${H}, integer coordinates. Ids are ISO 3166-1 alpha-3; names from
   world-countries. Nothing here talks to the network — ever. */
(function () {
  'use strict';
  var G = ${JSON.stringify(payload)};
  /* Equal Earth forward projection (Šavrič, Patterson & Jenny 2018), scaled
     to the same fit d3-geo produced the country paths with — so authored
     lon/lat points land exactly on their pre-projected countries. */
  var A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
  G.project = function (lon, lat) {
    var L = lon * Math.PI / 180, P = lat * Math.PI / 180;
    var t = Math.asin(M * Math.sin(P)), t2 = t * t, t6 = t2 * t2 * t2;
    var x = (L * Math.cos(t)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
    var y = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
    return [G.tx + G.k * x, G.ty - G.k * y];
  };
  /* look a country up by ISO alpha-3 ("NLD") or display name ("Netherlands"),
     case-insensitively */
  G.find = function (q) {
    if (q == null) return null;
    var s = String(q).toLowerCase();
    for (var i = 0; i < G.countries.length; i++) {
      var c = G.countries[i];
      if (c.id.toLowerCase() === s || c.name.toLowerCase() === s) return c;
    }
    return null;
  };
  window.__kitGeo = G;
})();
`;
const out = join(dirname(fileURLToPath(import.meta.url)), '../components/geo-world.js');
writeFileSync(out, js);
console.log(`wrote ${out} (${Math.round(Buffer.byteLength(js) / 1024)} KB, ${countries.length} countries, viewBox 0 0 ${W} ${H})`);
