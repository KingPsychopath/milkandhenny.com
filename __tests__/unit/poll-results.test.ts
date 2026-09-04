import { describe, expect, it } from "vitest";

import {
  buildPollResults,
  normalisePollOptions,
  validateSelections,
} from "@/features/polls/poll-results";

const options = [
  { id: "tuesday", label: "Tuesday" },
  { id: "wednesday", label: "Wednesday" },
  { id: "thursday", label: "Thursday" },
];

describe("poll results", () => {
  it("should preserve every option while weighting the strongest preference to one", () => {
    expect(buildPollResults(options, { tuesday: 2, wednesday: 5 }, 5)).toEqual([
      { id: "tuesday", label: "Tuesday", votes: 2, weight: 0.4, percentage: 40 },
      { id: "wednesday", label: "Wednesday", votes: 5, weight: 1, percentage: 100 },
      { id: "thursday", label: "Thursday", votes: 0, weight: 0, percentage: 0 },
    ]);
  });

  it("should reject unknown and ambiguous single-choice ballots", () => {
    expect(() => validateSelections(options, "single", ["someday"])).toThrow("Choose an answer");
    expect(() => validateSelections(options, "single", ["tuesday", "wednesday"])).toThrow(
      "Choose one",
    );
    expect(validateSelections(options, "multiple", ["tuesday", "tuesday", "thursday"])).toEqual([
      "tuesday",
      "thursday",
    ]);
  });

  it("should create stable distinct option identifiers from editor input", () => {
    expect(
      normalisePollOptions([
        { id: " Tuesday ", label: " Tuesday " },
        { id: "Tuesday", label: "Duplicate" },
        { id: "Wednesday night", label: "Wednesday" },
        { id: "", label: "Missing" },
      ]),
    ).toEqual([
      { id: "tuesday", label: "Tuesday" },
      { id: "wednesday-night", label: "Wednesday" },
    ]);
  });
});
