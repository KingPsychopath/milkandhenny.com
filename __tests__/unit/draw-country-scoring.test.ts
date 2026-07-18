import { describe, expect, it } from "vitest";
import { COUNTRIES } from "../../features/things/draw-country/countries";
import {
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

function exactDrawing(outline: CountryOutline): CountryDrawing {
  return outline.rings.map((ring) =>
    ring.map(([x, y]) => ({
      x: 137 + x * outline.aspect * 0.083,
      y: 83 + y * 0.083,
    })),
  );
}

describe("draw-country scoring", () => {
  it("scores every translated and uniformly scaled reference outline at 100", () => {
    for (const outline of COUNTRIES)
      expect(scoreCountryDrawing(outline, exactDrawing(outline)).score, outline.id).toBe(100);
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
        outward.strokeDeviation +
        outward.islandDeviation,
    ).toBeCloseTo(outward.deviation, 1);
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

  it("uses explicit, monotonic calibration anchors", () => {
    expect([0, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.45, 0.55].map(scoreFromDeviation)).toEqual([
      100, 94, 87, 70, 50, 35, 24, 12, 3, 0,
    ]);
  });
});
