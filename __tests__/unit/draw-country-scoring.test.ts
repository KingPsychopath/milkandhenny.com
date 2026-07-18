import { describe, expect, it } from "vitest";
import { COUNTRIES } from "../../features/things/draw-country/countries";
import {
  drawingIsValid,
  scoreCountryDrawing,
  scoreFromDeviation,
} from "../../features/things/draw-country/scoring";
import type { CountryDrawing, CountryOutline } from "../../features/things/draw-country/types";

const SQUARE = [
  [0, 0],
  [10_000, 0],
  [10_000, 10_000],
  [0, 10_000],
];

function country(rings: number[][][] = [SQUARE], aspect = 1): CountryOutline {
  return { id: "ZZ", name: "Testland", continent: "Test", aspect, rings };
}

function exactDrawing(
  outline: CountryOutline,
  placement = { x: 137, y: 83, scale: 0.083 },
): CountryDrawing {
  return outline.rings.map((ring) =>
    ring.map(([x, y]) => ({
      x: placement.x + x * outline.aspect * placement.scale,
      y: placement.y + y * placement.scale,
    })),
  );
}

function drawingBounds(drawing: CountryDrawing) {
  const points = drawing.flat();
  const x = points.map((point) => point.x);
  const y = points.map((point) => point.y);
  const minX = Math.min(...x);
  const maxX = Math.max(...x);
  const minY = Math.min(...y);
  const maxY = Math.max(...y);
  return {
    minX,
    minY,
    width: maxX - minX,
    height: maxY - minY,
    extent: Math.max(maxX - minX, maxY - minY),
    centreX: (minX + maxX) / 2,
    centreY: (minY + maxY) / 2,
  };
}

function nearExactDrawings(outline: CountryOutline) {
  const exact = exactDrawing(outline);
  const bounds = drawingBounds(exact);
  const angle = Math.PI / 120;
  return {
    stretched: exact.map((ring) =>
      ring.map((point) => ({
        x: bounds.centreX + (point.x - bounds.centreX) * 1.04,
        y: point.y,
      })),
    ),
    rotated: exact.map((ring) =>
      ring.map((point) => ({
        x:
          bounds.centreX +
          (point.x - bounds.centreX) * Math.cos(angle) -
          (point.y - bounds.centreY) * Math.sin(angle),
        y:
          bounds.centreY +
          (point.x - bounds.centreX) * Math.sin(angle) +
          (point.y - bounds.centreY) * Math.cos(angle),
      })),
    ),
    warped: exact.map((ring) =>
      ring.map((point) => ({
        x:
          point.x +
          Math.sin(((point.y - bounds.minY) / bounds.height) * Math.PI * 2) * bounds.extent * 0.004,
        y:
          point.y +
          Math.sin(((point.x - bounds.minX) / bounds.width) * Math.PI * 2) * bounds.extent * 0.004,
      })),
    ),
  };
}

function enclosingBoxDrawing(outline: CountryOutline): CountryDrawing {
  const bounds = drawingBounds(exactDrawing(outline));
  const padding = bounds.extent * 0.03;
  return [
    [
      { x: bounds.minX - padding, y: bounds.minY - padding },
      { x: bounds.centreX, y: bounds.minY - padding },
      { x: bounds.minX + bounds.width + padding, y: bounds.minY - padding },
      { x: bounds.minX + bounds.width + padding, y: bounds.centreY },
      {
        x: bounds.minX + bounds.width + padding,
        y: bounds.minY + bounds.height + padding,
      },
      { x: bounds.centreX, y: bounds.minY + bounds.height + padding },
      { x: bounds.minX - padding, y: bounds.minY + bounds.height + padding },
      { x: bounds.minX - padding, y: bounds.centreY },
    ],
  ];
}

describe("draw-country scoring", () => {
  it("requires a closed area rather than a line with enough sampled points", () => {
    const line = [Array.from({ length: 6 }, (_, index) => ({ x: 100 + index * 20, y: 100 }))];
    const outline = [
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 250, y: 160 },
        { x: 200, y: 220 },
        { x: 100, y: 220 },
        { x: 50, y: 160 },
      ],
    ];

    expect(drawingIsValid(line)).toBe(false);
    expect(drawingIsValid(outline)).toBe(true);
  });

  it("scores every translated and uniformly scaled reference outline at 100", () => {
    for (const outline of COUNTRIES)
      expect(scoreCountryDrawing(outline, exactDrawing(outline)).score, outline.id).toBe(100);
  });

  it("does not penalise an exact outline drawn at a different position or size", () => {
    const namibia = COUNTRIES.find(({ id }) => id === "NA");
    expect(namibia).toBeDefined();
    if (!namibia) throw new Error("Namibia fixture is missing");

    expect(
      [
        { x: 20, y: 15, scale: 0.035 },
        { x: 420, y: 180, scale: 0.061 },
        { x: -260, y: -310, scale: 0.14 },
      ].map((placement) => scoreCountryDrawing(namibia, exactDrawing(namibia, placement)).score),
    ).toEqual([100, 100, 100]);
  });

  it("keeps every near-exact country high despite small human faults", () => {
    for (const outline of COUNTRIES) {
      for (const [fault, drawing] of Object.entries(nearExactDrawings(outline)))
        expect(
          scoreCountryDrawing(outline, drawing).score,
          `${outline.id} ${fault}`,
        ).toBeGreaterThanOrEqual(70);
    }
  });

  it("aligns translation and uniform scale without correcting rotation", () => {
    const rectangle = country([SQUARE], 2);
    const exact = exactDrawing(rectangle);
    const rotated = exact.map((ring) => ring.map(({ x, y }) => ({ x: 800 - y, y: x + 200 })));

    expect(scoreCountryDrawing(rectangle, exact).score).toBe(100);
    expect(scoreCountryDrawing(rectangle, rotated).score).toBeLessThan(60);
  });

  it("keeps the main outline aligned when a tiny stray stroke is far away", () => {
    const outline = country();
    const drawing = exactDrawing(outline);
    drawing.push([
      { x: 5_000, y: 5_000 },
      { x: 5_020, y: 5_000 },
      { x: 5_010, y: 5_020 },
    ]);

    const evaluation = scoreCountryDrawing(outline, drawing);
    expect(evaluation.score).toBeGreaterThanOrEqual(90);
    expect(evaluation.score).toBeLessThan(100);
    expect(evaluation.drawing[0][0].x).toBeCloseTo(evaluation.reference[0][0].x, 2);
    expect(evaluation.drawing[0][0].y).toBeCloseTo(evaluation.reference[0][0].y, 2);
  });

  it("attributes inward and outward mistakes separately while scoring both", () => {
    const diamond: CountryDrawing = [
      [
        { x: 500, y: 0 },
        { x: 1_000, y: 500 },
        { x: 500, y: 1_000 },
        { x: 0, y: 500 },
      ],
    ];
    const squareDrawing: CountryDrawing = [
      [
        { x: 0, y: 0 },
        { x: 1_000, y: 0 },
        { x: 1_000, y: 1_000 },
        { x: 0, y: 1_000 },
      ],
    ];
    const diamondOutline = country([
      [
        [5_000, 0],
        [10_000, 5_000],
        [5_000, 10_000],
        [0, 5_000],
      ],
    ]);

    const inward = scoreCountryDrawing(country(), diamond);
    const outward = scoreCountryDrawing(diamondOutline, squareDrawing);
    expect(inward.insideDeviation).toBeGreaterThan(inward.outsideDeviation);
    expect(outward.outsideDeviation).toBeGreaterThan(outward.insideDeviation);
    expect(inward.score).toBeLessThan(100);
    expect(outward.score).toBeLessThan(100);
    expect(
      outward.outsideDeviation +
        outward.insideDeviation +
        outward.coverageDeviation +
        outward.silhouetteDeviation +
        outward.mismatchDeviation +
        outward.strokeDeviation +
        outward.islandDeviation,
    ).toBeCloseTo(outward.deviation, 0);
  });

  it("barely penalises a microscopic omitted island but catches a major one", () => {
    const mainland = [
      [0, 0],
      [6_000, 0],
      [6_000, 6_000],
      [0, 6_000],
    ];
    const microscopic = [
      [9_900, 9_900],
      [9_920, 9_900],
      [9_920, 9_920],
      [9_900, 9_920],
    ];
    const major = [
      [7_000, 7_000],
      [10_000, 7_000],
      [10_000, 10_000],
      [7_000, 10_000],
    ];
    const mainlandDrawing: CountryDrawing = [
      [
        { x: 0, y: 0 },
        { x: 600, y: 0 },
        { x: 600, y: 600 },
        { x: 0, y: 600 },
      ],
    ];

    const microscopicResult = scoreCountryDrawing(
      country([mainland, microscopic]),
      mainlandDrawing,
    );
    const majorResult = scoreCountryDrawing(country([mainland, major]), mainlandDrawing);
    expect(microscopicResult.score).toBeGreaterThanOrEqual(95);
    expect(microscopicResult.islandDeviation).toBeLessThan(1);
    expect(majorResult.score).toBeLessThanOrEqual(60);
    expect(majorResult.islandDeviation).toBeGreaterThan(0);
  });

  it("rejects fragmented crossing scribbles that happen to touch much of the border", () => {
    const australia = COUNTRIES.find(({ id }) => id === "AU");
    expect(australia).toBeDefined();
    if (!australia) throw new Error("Australia fixture is missing");
    const points = (values: number[][]) => values.map(([x, y]) => ({ x, y }));
    const scribble: CountryDrawing = [
      points([
        [380, 180],
        [500, 150],
        [620, 160],
        [700, 240],
        [680, 330],
        [760, 400],
        [720, 500],
        [580, 550],
        [430, 500],
        [330, 420],
        [320, 300],
      ]),
      points([
        [120, 500],
        [350, 510],
        [560, 560],
        [820, 590],
        [850, 650],
        [250, 650],
        [120, 620],
      ]),
      points([
        [180, 520],
        [380, 540],
        [580, 590],
        [360, 500],
      ]),
      points([
        [160, 160],
        [160, 220],
        [160, 280],
        [160, 340],
      ]),
      points([
        [420, 100],
        [420, 170],
        [420, 240],
        [420, 310],
      ]),
    ];

    expect(scoreCountryDrawing(australia, scribble).score).toBeLessThanOrEqual(20);
  });

  it("does not reward covering, enclosing, or repeatedly tracing the country", () => {
    const australia = COUNTRIES.find(({ id }) => id === "AU");
    expect(australia).toBeDefined();
    if (!australia) throw new Error("Australia fixture is missing");

    const serpent: CountryDrawing[number] = [];
    for (let row = 0; row < 12; row += 1) {
      const y = 100 + row * 45;
      serpent.push(
        ...(row % 2
          ? [
              { x: 850, y },
              { x: 120, y },
            ]
          : [
              { x: 120, y },
              { x: 850, y },
            ]),
      );
    }
    const exact = exactDrawing(australia);
    const enclosingBox: CountryDrawing = [
      [
        { x: 50, y: 50 },
        { x: 500, y: 50 },
        { x: 950, y: 50 },
        { x: 950, y: 350 },
        { x: 950, y: 650 },
        { x: 500, y: 650 },
        { x: 50, y: 650 },
        { x: 50, y: 350 },
      ],
    ];

    expect(scoreCountryDrawing(australia, [serpent]).score).toBeLessThanOrEqual(10);
    expect(
      scoreCountryDrawing(australia, [...exact, ...exact, ...exact]).score,
    ).toBeLessThanOrEqual(10);
    expect(scoreCountryDrawing(australia, enclosingBox).score).toBeLessThanOrEqual(30);
  });

  it("keeps a coherent rough silhouette low without collapsing it to zero", () => {
    const china = COUNTRIES.find(({ id }) => id === "CN");
    expect(china).toBeDefined();
    if (!china) throw new Error("China fixture is missing");
    const roughPentagon: CountryDrawing = [
      [
        { x: 180, y: 110 },
        { x: 610, y: 130 },
        { x: 850, y: 360 },
        { x: 600, y: 650 },
        { x: 120, y: 560 },
      ],
    ];

    const result = scoreCountryDrawing(china, roughPentagon);
    expect(result.score).toBeGreaterThanOrEqual(10);
    expect(result.score).toBeLessThanOrEqual(30);
  });

  it("keeps a crude compact-country attempt meaningfully above zero", () => {
    const eswatini = COUNTRIES.find(({ id }) => id === "SZ");
    expect(eswatini).toBeDefined();
    if (!eswatini) throw new Error("eSwatini fixture is missing");

    const result = scoreCountryDrawing(eswatini, enclosingBoxDrawing(eswatini));
    expect(result.score).toBeGreaterThanOrEqual(15);
    expect(result.score).toBeLessThanOrEqual(35);
    expect(result.mismatchDeviation).toBeGreaterThan(0);
  });

  it("rewards recognisable simplifications across compact, thin, and coastal countries", () => {
    const expectedFloors = { AU: 50, CN: 70, CL: 55, NA: 70, GB: 40, IT: 35 } as const;
    for (const [countryId, floor] of Object.entries(expectedFloors)) {
      const outline = COUNTRIES.find(({ id }) => id === countryId);
      expect(outline).toBeDefined();
      if (!outline) continue;
      const step = Math.max(1, Math.floor(outline.rings[0].length / 20));
      const simplified: CountryDrawing = [
        outline.rings[0]
          .filter((_, index) => index % step === 0)
          .map(([x, y]) => ({ x: 137 + x * outline.aspect * 0.083, y: 83 + y * 0.083 })),
      ];
      expect(scoreCountryDrawing(outline, simplified).score, countryId).toBeGreaterThanOrEqual(
        floor,
      );
    }
  });

  it("does not mistake another recognisable country for the target", () => {
    const australia = COUNTRIES.find(({ id }) => id === "AU");
    const brazil = COUNTRIES.find(({ id }) => id === "BR");
    expect(australia).toBeDefined();
    expect(brazil).toBeDefined();
    if (!australia || !brazil) throw new Error("Country fixtures are missing");

    expect(scoreCountryDrawing(australia, exactDrawing(brazil)).score).toBeLessThanOrEqual(25);
  });

  it("keeps compactness tolerance strict against boxes and wrong countries", () => {
    for (const countryId of ["CL", "GB", "IT", "ID", "AU", "CN"]) {
      const outline = COUNTRIES.find(({ id }) => id === countryId);
      expect(outline).toBeDefined();
      if (outline)
        expect(
          scoreCountryDrawing(outline, enclosingBoxDrawing(outline)).score,
          countryId,
        ).toBeLessThanOrEqual(35);
    }

    for (const [drawingId, targetId] of [
      ["BR", "CL"],
      ["AU", "GB"],
      ["BR", "IT"],
      ["NA", "ID"],
    ]) {
      const drawingCountry = COUNTRIES.find(({ id }) => id === drawingId);
      const targetCountry = COUNTRIES.find(({ id }) => id === targetId);
      expect(drawingCountry).toBeDefined();
      expect(targetCountry).toBeDefined();
      if (drawingCountry && targetCountry)
        expect(
          scoreCountryDrawing(targetCountry, exactDrawing(drawingCountry)).score,
          `${drawingId} as ${targetId}`,
        ).toBeLessThanOrEqual(25);
    }
  });

  it("uses explicit, monotonic calibration anchors", () => {
    expect([0, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.45, 0.55].map(scoreFromDeviation)).toEqual([
      100, 94, 87, 70, 50, 35, 24, 12, 3, 0,
    ]);
  });
});
