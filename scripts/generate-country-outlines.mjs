import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SOURCE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson";
const OUTPUT = resolve("features/things/draw-country/countries.generated.json");
const COORDINATE_SCALE = 10_000;
const MAX_RINGS = 32;
const MINIMUM_RELATIVE_AREA = 0.00004;
const CORE_OUTLINE_CODES = new Set(["CL", "EC", "ES", "FR", "NL", "NO", "PT"]);
const COUNTRY_CODES =
  `AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW PS`.split(
    " ",
  );

const CONTINENT_ORDER = ["Africa", "Asia", "Europe", "North America", "South America", "Oceania"];

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    area += point[0] * next[1] - next[0] * point[1];
  }
  return Math.abs(area / 2);
}

function cross(start, end, point) {
  return (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]);
}

function segmentsCross(a, b, c, d) {
  if (
    Math.max(a[0], b[0]) <= Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) <= Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) <= Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) <= Math.min(a[1], b[1])
  )
    return false;
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return (
    ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
  );
}

function ringCrossesItself(ring) {
  for (let first = 0; first < ring.length; first += 1) {
    for (let second = first + 2; second < ring.length; second += 1) {
      if (first === 0 && second === ring.length - 1) continue;
      if (
        segmentsCross(
          ring[first],
          ring[(first + 1) % ring.length],
          ring[second],
          ring[(second + 1) % ring.length],
        )
      )
        return true;
    }
  }
  return false;
}

function openRing(points) {
  const closed = points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
  return closed ? points.slice(0, -1) : points;
}

function outerRings(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates[0]];
  return geometry.coordinates.map((polygon) => polygon[0]);
}

function projectedRings(feature) {
  const latitude = Number(feature.properties.LABEL_Y ?? 0);
  const longitudeScale = Math.max(0.2, Math.cos((latitude * Math.PI) / 180));
  const rings = outerRings(feature.geometry).map((ring) => {
    let previous = ring[0][0];
    let offset = 0;
    return ring.map(([longitude, y], index) => {
      if (index > 0) {
        const delta = longitude + offset - previous;
        if (delta > 180) offset -= 360;
        else if (delta < -180) offset += 360;
      }
      const x = (longitude + offset) * longitudeScale;
      previous = longitude + offset;
      return [x, -y];
    });
  });
  const largest = rings.toSorted((a, b) => polygonArea(b) - polygonArea(a))[0];
  const anchor = largest.reduce((sum, point) => sum + point[0], 0) / largest.length;
  return rings.map((ring) => {
    const centre = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
    const worldWidth = 360 * longitudeScale;
    const shift = Math.round((anchor - centre) / worldWidth) * worldWidth;
    return ring.map(([x, y]) => [x + shift, y]);
  });
}

function ringBounds(points) {
  return {
    minX: Math.min(...points.map(([x]) => x)),
    maxX: Math.max(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxY: Math.max(...points.map(([, y]) => y)),
  };
}

function recognisableCore(ranked) {
  const bounds = ringBounds(ranked[0].points);
  const margin = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.35;
  return ranked.filter(({ points }) => {
    const ring = ringBounds(points);
    return (
      ring.maxX >= bounds.minX - margin &&
      ring.minX <= bounds.maxX + margin &&
      ring.maxY >= bounds.minY - margin &&
      ring.minY <= bounds.maxY + margin
    );
  });
}

function normalise(feature, code) {
  const projected = projectedRings(feature);
  const allRanked = projected
    .map((points) => ({ points, area: polygonArea(points) }))
    .toSorted((a, b) => b.area - a.area);
  const ranked = CORE_OUTLINE_CODES.has(code) ? recognisableCore(allRanked) : allRanked;
  const minimumArea = ranked[0].area * MINIMUM_RELATIVE_AREA;
  const retained = ranked.filter(
    ({ area }, index) => index < MAX_RINGS && (index === 0 || area >= minimumArea),
  );
  const all = retained.flatMap(({ points }) => points);
  const minX = Math.min(...all.map(([x]) => x));
  const maxX = Math.max(...all.map(([x]) => x));
  const minY = Math.min(...all.map(([, y]) => y));
  const maxY = Math.max(...all.map(([, y]) => y));
  const width = Math.max(0.000001, maxX - minX);
  const height = Math.max(0.000001, maxY - minY);
  const rings = retained
    .map(({ points }) =>
      openRing(points).map(([x, y]) => [
        Math.round(((x - minX) / width) * COORDINATE_SCALE),
        Math.round(((y - minY) / height) * COORDINATE_SCALE),
      ]),
    )
    .map((ring) => {
      const deduplicated = ring.filter(
        (point, index) =>
          index === 0 || point[0] !== ring[index - 1][0] || point[1] !== ring[index - 1][1],
      );
      const first = deduplicated[0];
      const last = deduplicated.at(-1);
      if (first && last && first[0] === last[0] && first[1] === last[1]) deduplicated.pop();
      return deduplicated;
    })
    .filter((ring) => ring.length >= 3 && polygonArea(ring) > 0);
  if (!rings.length) throw new Error(`No usable rings for ${feature.properties.ADMIN}`);
  return {
    aspect: Math.round((width / height) * 1_000) / 1_000,
    rings,
  };
}

function auditCountries(countries) {
  if (countries.length !== COUNTRY_CODES.length)
    throw new Error(`Expected ${COUNTRY_CODES.length} countries, received ${countries.length}`);
  const ids = new Set();
  let ringCount = 0;
  let pointCount = 0;
  for (const country of countries) {
    if (ids.has(country.id)) throw new Error(`Duplicate country id: ${country.id}`);
    ids.add(country.id);
    if (!country.name || !country.continent) throw new Error(`Missing metadata for ${country.id}`);
    if (!Number.isFinite(country.aspect) || country.aspect <= 0)
      throw new Error(`Invalid aspect for ${country.id}`);
    if (!country.rings.length) throw new Error(`Missing outline for ${country.id}`);
    for (const [ringIndex, ring] of country.rings.entries()) {
      const label = `${country.id} ring ${ringIndex + 1}`;
      if (ring.length < 3) throw new Error(`${label} has fewer than three points`);
      if (new Set(ring.map(([x, y]) => `${x},${y}`)).size < 3)
        throw new Error(`${label} has fewer than three distinct points`);
      if (polygonArea(ring) <= 0) throw new Error(`${label} has no area`);
      if (ringCrossesItself(ring)) throw new Error(`${label} crosses itself`);
      for (const [pointIndex, [x, y]] of ring.entries()) {
        if (
          !Number.isInteger(x) ||
          !Number.isInteger(y) ||
          x < 0 ||
          x > COORDINATE_SCALE ||
          y < 0 ||
          y > COORDINATE_SCALE
        )
          throw new Error(`${label} has an invalid point at ${pointIndex + 1}`);
        const next = ring[(pointIndex + 1) % ring.length];
        if (x === next[0] && y === next[1])
          throw new Error(`${label} repeats point ${pointIndex + 1}`);
      }
      ringCount += 1;
      pointCount += ring.length;
    }
  }
  const missing = COUNTRY_CODES.filter((id) => !ids.has(id));
  if (missing.length) throw new Error(`Missing country ids: ${missing.join(", ")}`);
  return { ringCount, pointCount };
}

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`Natural Earth download failed: ${response.status}`);
const collection = await response.json();
const countries = COUNTRY_CODES.map((code) => {
  const candidates = collection.features.filter(
    (feature) => feature.properties.ISO_A2_EH === code || feature.properties.ISO_A2 === code,
  );
  const feature =
    candidates.find(({ properties }) =>
      ["Sovereign country", "Country"].includes(properties.TYPE),
    ) ?? candidates[0];
  if (!feature) throw new Error(`No Natural Earth outline for ${code}`);
  const continent =
    feature.properties.CONTINENT === "Seven seas (open ocean)"
      ? "Oceania"
      : feature.properties.CONTINENT;
  const nameOverrides = {
    BO: "Bolivia",
    BN: "Brunei",
    CD: "DR Congo",
    CG: "Congo",
    CI: "Côte d’Ivoire",
    CZ: "Czechia",
    FM: "Micronesia",
    GB: "United Kingdom",
    IR: "Iran",
    KP: "North Korea",
    KR: "South Korea",
    LA: "Laos",
    MD: "Moldova",
    PS: "Palestine",
    RU: "Russia",
    SY: "Syria",
    TZ: "Tanzania",
    US: "United States",
    VA: "Vatican City",
    VE: "Venezuela",
    VN: "Vietnam",
  };
  return {
    id: code,
    name: nameOverrides[code] ?? feature.properties.ADMIN,
    continent,
    ...normalise(feature, code),
  };
}).toSorted((a, b) => {
  const continent = CONTINENT_ORDER.indexOf(a.continent) - CONTINENT_ORDER.indexOf(b.continent);
  return continent || a.name.localeCompare(b.name);
});

const audit = auditCountries(countries);

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(countries)}\n`);
console.log(
  `Audited ${countries.length} countries, ${audit.ringCount} rings, and ${audit.pointCount} points`,
);
console.log(`Wrote country outlines to ${OUTPUT}`);
