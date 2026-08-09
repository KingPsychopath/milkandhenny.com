import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// 10m is the finest Natural Earth admin-0 tier. The coarser 50m tier collapses microstates into
// unrecognisable blobs — San Marino arrived as a six-point lozenge — so every outline is sourced
// here and simplified back down to a shared point budget instead.
const SOURCE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson";
const OUTPUT = resolve("public/assets/draw-country-atlas-v1.json");
const COORDINATE_SCALE = 10_000;
const MAX_RINGS = 32;
// Islands below a thousandth of the mainland are specks no player could place; at 10m resolution
// the source is full of them, and keeping them only adds noise to the outline and the score.
const MINIMUM_RELATIVE_AREA = 0.001;
const MINIMUM_DISPLAY_AREA = 0.01;
// Automatic cropping of remote specks: only rings holding a rounding error of the country's land
// may go, and only when dropping one measurably enlarges what the player actually draws.
const NEGLIGIBLE_RING_AREA = 0.005;
const CROP_MINIMUM_GAIN = 1.25;
// Douglas–Peucker runs only as hard as it must: the smallest tolerance that fits the budget wins,
// so simple outlines keep every source vertex and only the sprawling coastlines get thinned.
const POINT_BUDGET = 500;
// A ring that cannot reach its allowance without self-intersecting is allowed to overshoot, so the
// audit bound is looser than the budget the simplifier aims for.
const MAX_OUTLINE_POINTS = 4_000;
const MINIMUM_RING_POINTS = 8;
const SIMPLIFY_SEARCH_STEPS = 32;
const SIMPLIFY_BACKOFF_STEPS = 24;
// A ring that folds at its allowance is retried with proportionally more points kept.
const SIMPLIFY_BACKOFF_RATIO = 0.7;
// Warn (don't fail) when a country is inherently low-detail — Vatican City and Nauru really are
// this simple at every resolution, but a regression elsewhere should be visible in the log.
const COARSE_OUTLINE_POINTS = 12;
// Crop distant territories or island groups whose full geographic spread makes the outline unreadable.
const CORE_OUTLINE_CODES = new Set([
  "CL",
  "EC",
  "ES",
  "FM",
  "FR",
  "KI",
  "MH",
  "MU",
  "MV",
  "NL",
  "NO",
  "PT",
  "PW",
  "SC",
  "TO",
  "TV",
]);
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

function triangleArea(first, second, third) {
  return (
    Math.abs(
      (second[0] - first[0]) * (third[1] - first[1]) -
        (third[0] - first[0]) * (second[1] - first[1]),
    ) / 2
  );
}

/**
 * Simplify a closed ring to a point count by Visvalingam–Whyatt: repeatedly drop the vertex whose
 * triangle with its surviving neighbours is smallest.
 *
 * Douglas–Peucker did this job until it was measured against the source. It keeps whichever vertex
 * lies furthest from the chord, which is a selection rule *for* spikes: at a 200-point budget it
 * rendered Iceland as a starburst and Norway as a saw blade, while the 3,000-point source is
 * neither. Dropping by area instead sheds the noise and keeps the silhouette, so the same budget
 * reproduces both coastlines recognisably. Area also lets the caller name a point count outright
 * rather than binary-searching tolerances for one.
 *
 * Effective areas are kept non-decreasing as vertices go, so a point can never outlive one that was
 * more significant than it — without that, a vertex stranded between two removals can be dropped
 * out of order and take a headland with it.
 */
function simplifyRingToCount(ring, target) {
  const size = ring.length;
  if (size <= Math.max(3, target)) return ring;
  const previous = new Int32Array(size);
  const next = new Int32Array(size);
  const alive = new Uint8Array(size).fill(1);
  const effective = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    previous[index] = (index - 1 + size) % size;
    next[index] = (index + 1) % size;
  }
  for (let index = 0; index < size; index += 1)
    effective[index] = triangleArea(ring[previous[index]], ring[index], ring[next[index]]);

  // Binary heap over (area, vertex), stale entries skipped on pop rather than removed.
  const heap = [];
  const push = (entry) => {
    heap.push(entry);
    let child = heap.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (heap[parent][0] <= heap[child][0]) break;
      [heap[parent], heap[child]] = [heap[child], heap[parent]];
      child = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < heap.length && heap[left][0] < heap[smallest][0]) smallest = left;
        if (right < heap.length && heap[right][0] < heap[smallest][0]) smallest = right;
        if (smallest === parent) break;
        [heap[smallest], heap[parent]] = [heap[parent], heap[smallest]];
        parent = smallest;
      }
    }
    return top;
  };
  for (let index = 0; index < size; index += 1) push([effective[index], index]);

  let remaining = size;
  while (remaining > target && heap.length) {
    const [area, index] = pop();
    if (!alive[index] || area !== effective[index]) continue;
    alive[index] = 0;
    remaining -= 1;
    const before = previous[index];
    const after = next[index];
    next[before] = after;
    previous[after] = before;
    for (const neighbour of [before, after]) {
      if (!alive[neighbour]) continue;
      effective[neighbour] = Math.max(
        area,
        triangleArea(ring[previous[neighbour]], ring[neighbour], ring[next[neighbour]]),
      );
      push([effective[neighbour], neighbour]);
    }
  }
  return ring.filter((_, index) => alive[index]);
}

function countPoints(rings) {
  return rings.reduce((total, ring) => total + ring.length, 0);
}

function ringsIntersect(first, second) {
  for (let a = 0; a < first.length; a += 1)
    for (let b = 0; b < second.length; b += 1)
      if (
        segmentsCross(
          first[a],
          first[(a + 1) % first.length],
          second[b],
          second[(b + 1) % second.length],
        )
      )
        return true;
  return false;
}

/**
 * Simplifying a coastline can sweep it across a neighbouring islet, leaving two rings that overlap —
 * which reads as a crossed-out scribble to both the eye and the scorer. An islet the simplified
 * coastline now covers is smaller than the outline's own accuracy, so it is dropped rather than
 * redrawn; the largest ring is never the one discarded.
 */
function separateRings(rings) {
  const ordered = rings.toSorted((a, b) => polygonArea(b) - polygonArea(a));
  const kept = [];
  for (const ring of ordered)
    if (!kept.some((other) => ringsIntersect(other, ring))) kept.push(ring);
  return kept;
}

function ringIsSimple(ring) {
  return ring.length >= 3 && polygonArea(ring) > 0 && !ringCrossesItself(ring);
}

/**
 * Thin one ring towards its share of the budget without letting it fold onto itself.
 *
 * Visvalingam is not topology-preserving either — a coast cut by hairpin inlets can still sweep one
 * bank across another — so the target is relaxed until the ring comes back intact. It folds far
 * less often than the perpendicular-distance rule did, because the vertices it drops are the ones
 * enclosing least area rather than the ones nearest their chord.
 */
function simplifyRingToAllowance(ring, allowance) {
  if (ring.length <= allowance) return ring;
  let target = allowance;
  for (let step = 0; step < SIMPLIFY_BACKOFF_STEPS; step += 1) {
    const candidate = simplifyRingToCount(ring, target);
    if (ringIsSimple(candidate)) return candidate;
    if (candidate.length >= ring.length) break;
    target = Math.ceil(target / SIMPLIFY_BACKOFF_RATIO);
    if (target >= ring.length) break;
  }
  return ring;
}

/**
 * Rounding source degrees onto the integer grid can pinch a hair-thin feature — Eritrea's Dahlak
 * reefs are the culprit — into a ring that crosses itself. Simplify just enough to undo the fold,
 * and drop the ring outright when nothing recovers it.
 */
function repairRing(ring) {
  if (ringIsSimple(ring)) return ring;
  for (let step = 1; step <= SIMPLIFY_SEARCH_STEPS; step += 1) {
    const target = Math.max(3, Math.round(ring.length * (1 - step / SIMPLIFY_SEARCH_STEPS)));
    const candidate = simplifyRingToCount(ring, target);
    if (candidate.length < ring.length && ringIsSimple(candidate)) return candidate;
  }
  return null;
}

/**
 * Fit an outline into the shared point budget, giving each ring a share proportional to its source
 * detail. Outlines already under budget keep every source vertex untouched.
 */
function ringPerimeter(ring) {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const next = ring[(index + 1) % ring.length];
    total += Math.hypot(next[0] - ring[index][0], next[1] - ring[index][1]);
  }
  return total;
}

/**
 * Fit an outline into the shared point budget. Shares go by drawn perimeter rather than by source
 * vertex count: a fjord-riddled islet can carry more source vertices than a whole mainland without
 * being any more of the picture, and paying by vertices left Great Britain thinner than its own
 * offshore rocks.
 */
function simplifyToBudget(rings) {
  if (countPoints(rings) <= POINT_BUDGET) return rings;
  const perimeters = rings.map(ringPerimeter);
  const total = perimeters.reduce((sum, value) => sum + value, 0) || 1;
  return rings
    .map((ring, index) =>
      simplifyRingToAllowance(
        ring,
        Math.max(MINIMUM_RING_POINTS, Math.floor((perimeters[index] / total) * POINT_BUDGET)),
      ),
    )
    .filter((ring) => ring.length >= 3 && polygonArea(ring) > 0);
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

function buildOutline(feature, retained) {
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
  const simplified = simplifyToBudget(rings).map(repairRing);
  if (!simplified[0]) throw new Error(`Main outline for ${feature.properties.ADMIN} is degenerate`);
  return {
    aspect: Math.round((width / height) * 1_000) / 1_000,
    rings: separateRings(simplified.filter(Boolean)),
  };
}

/**
 * How much of the drawing frame the country actually fills. Normalising maps the combined bounding
 * box onto the coordinate square, so this reduces to land area over the squared longer side.
 */
function readability(ranked) {
  const all = ranked.flatMap(({ points }) => points);
  const bounds = ringBounds(all);
  const side = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  if (!side) return 0;
  return ranked.reduce((sum, { area }) => sum + area, 0) / side ** 2;
}

/**
 * Drop remote specks that stretch the frame without adding anything to draw. Removing whole regions
 * at once is too blunt — Equatorial Guinea's Annobón has to go while Bioko stays — so rings are
 * dropped one at a time, always the negligible ring whose removal recovers the most drawing area,
 * and only while that recovery is worth having.
 */
function withoutRemoteSpecks(ranked) {
  let current = ranked;
  let currentReadability = readability(current);
  while (current.length > 1) {
    const totalArea = current.reduce((sum, { area }) => sum + area, 0);
    let best = null;
    for (const [index, ring] of current.entries()) {
      if (ring.area > totalArea * NEGLIGIBLE_RING_AREA) continue;
      const candidate = current.filter((_, position) => position !== index);
      const gained = readability(candidate);
      if (!best || gained > best.readability) best = { candidate, readability: gained };
    }
    if (!best || best.readability < currentReadability * CROP_MINIMUM_GAIN) return current;
    current = best.candidate;
    currentReadability = best.readability;
  }
  return current;
}

function normalise(feature, code) {
  const allRanked = projectedRings(feature)
    .map((points) => ({ points, area: polygonArea(points) }))
    .toSorted((a, b) => b.area - a.area);
  const ranked = CORE_OUTLINE_CODES.has(code) ? recognisableCore(allRanked) : allRanked;
  const minimumArea = ranked[0].area * MINIMUM_RELATIVE_AREA;
  const retained = ranked.filter(
    ({ area }, index) => index < MAX_RINGS && (index === 0 || area >= minimumArea),
  );
  return buildOutline(feature, withoutRemoteSpecks(retained));
}

function auditCountries(countries) {
  if (countries.length !== COUNTRY_CODES.length)
    throw new Error(`Expected ${COUNTRY_CODES.length} countries, received ${countries.length}`);
  const ids = new Set();
  const coarse = [];
  let ringCount = 0;
  let pointCount = 0;
  for (const country of countries) {
    if (ids.has(country.id)) throw new Error(`Duplicate country id: ${country.id}`);
    ids.add(country.id);
    if (!country.name || !country.continent) throw new Error(`Missing metadata for ${country.id}`);
    if (!Number.isFinite(country.aspect) || country.aspect <= 0)
      throw new Error(`Invalid aspect for ${country.id}`);
    if (!country.rings.length) throw new Error(`Missing outline for ${country.id}`);
    const displayArea =
      country.rings.reduce((total, ring) => total + polygonArea(ring), 0) /
      COORDINATE_SCALE ** 2 /
      Math.max(country.aspect, 1 / country.aspect);
    if (displayArea < MINIMUM_DISPLAY_AREA)
      throw new Error(`Outline for ${country.id} is too sparse to display clearly`);
    const countryPoints = country.rings.reduce((total, ring) => total + ring.length, 0);
    if (countryPoints > MAX_OUTLINE_POINTS)
      throw new Error(`Outline for ${country.id} exceeds the ${MAX_OUTLINE_POINTS} point ceiling`);
    const mainRingPoints = Math.max(...country.rings.map((ring) => ring.length));
    if (mainRingPoints < COARSE_OUTLINE_POINTS) coarse.push(`${country.id} (${mainRingPoints})`);
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
      for (const [otherIndex, other] of country.rings.entries())
        if (otherIndex > ringIndex && ringsIntersect(ring, other))
          throw new Error(`${label} overlaps ring ${otherIndex + 1}`);
      ringCount += 1;
      pointCount += ring.length;
    }
  }
  const missing = COUNTRY_CODES.filter((id) => !ids.has(id));
  if (missing.length) throw new Error(`Missing country ids: ${missing.join(", ")}`);
  return { ringCount, pointCount, coarse };
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
if (audit.coarse.length)
  console.log(
    `Inherently low-detail outlines (fewer than ${COARSE_OUTLINE_POINTS} points): ${audit.coarse.join(", ")}`,
  );
console.log(`Wrote country outlines to ${OUTPUT}`);
