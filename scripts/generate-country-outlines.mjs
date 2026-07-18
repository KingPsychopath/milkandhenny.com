import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SOURCE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson";
const OUTPUT = resolve("features/things/draw-country/countries.generated.json");
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

function squareDistance(point, start, end) {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;
  if (dx || dy) {
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = end[0];
      y = end[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}

function simplify(points, tolerance) {
  if (points.length <= 4) return points;
  const closed = points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
  const source = closed ? points.slice(0, -1) : points;
  const keep = new Uint8Array(source.length);
  keep[0] = 1;
  keep[source.length - 1] = 1;
  const stack = [[0, source.length - 1]];
  const threshold = tolerance * tolerance;
  while (stack.length) {
    const [start, end] = stack.pop();
    let furthest = threshold;
    let chosen = -1;
    for (let index = start + 1; index < end; index += 1) {
      const distance = squareDistance(source[index], source[start], source[end]);
      if (distance > furthest) {
        furthest = distance;
        chosen = index;
      }
    }
    if (chosen >= 0) {
      keep[chosen] = 1;
      stack.push([start, chosen], [chosen, end]);
    }
  }
  const result = source.filter((_, index) => keep[index]);
  if (closed) result.push(result[0]);
  return result;
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

function normalise(feature) {
  const projected = projectedRings(feature);
  const ranked = projected
    .map((points) => ({ points, area: polygonArea(points) }))
    .toSorted((a, b) => b.area - a.area);
  const minimumArea = ranked[0].area * 0.00004;
  const retained = ranked.filter(
    ({ area }, index) => index < 18 && (index === 0 || area >= minimumArea),
  );
  const all = retained.flatMap(({ points }) => points);
  const minX = Math.min(...all.map(([x]) => x));
  const maxX = Math.max(...all.map(([x]) => x));
  const minY = Math.min(...all.map(([, y]) => y));
  const maxY = Math.max(...all.map(([, y]) => y));
  const width = Math.max(0.000001, maxX - minX);
  const height = Math.max(0.000001, maxY - minY);
  const extent = Math.max(width, height);
  const tolerance = extent * 0.004;
  return {
    aspect: Math.round((width / height) * 1_000) / 1_000,
    rings: retained.map(({ points }) =>
      simplify(points, tolerance).map(([x, y]) => [
        Math.round(((x - minX) / width) * 1_000),
        Math.round(((y - minY) / height) * 1_000),
      ]),
    ),
  };
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
    ...normalise(feature),
  };
}).toSorted((a, b) => {
  const continent = CONTINENT_ORDER.indexOf(a.continent) - CONTINENT_ORDER.indexOf(b.continent);
  return continent || a.name.localeCompare(b.name);
});

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(countries)}\n`);
console.log(`Wrote ${countries.length} countries to ${OUTPUT}`);
