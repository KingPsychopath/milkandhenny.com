import { describe, it, expect } from "vitest";
import { parseCSV } from "@/lib/guests/csv-parser";

const CSV_HEADER =
  "Name,Status,RSVP date,Did you enter your full name? (Enter your full name),Is Plus One Of";

/** Build a CSV string from rows (header auto-prepended) */
function csv(...rows: string[]): string {
  return [CSV_HEADER, ...rows].join("\n");
}

describe("parseCSV", () => {
  it("parses a single guest", () => {
    const input = csv("Alice,Approved,2026-01-15,,");
    const guests = parseCSV(input);

    expect(guests).toHaveLength(1);
    expect(guests[0].name).toBe("Alice");
    expect(guests[0].status).toBe("Approved");
    expect(guests[0].checkedIn).toBe(false);
    expect(guests[0].isPlusOne).toBe(false);
    expect(guests[0].plusOnes).toEqual([]);
  });

  it("links plus-ones to their host", () => {
    const input = csv(
      "Alice,Approved,2026-01-15,,",
      "Bob,Approved,2026-01-15,,Alice"
    );
    const guests = parseCSV(input);

    // Only main guests (non-plus-ones) in top-level array
    expect(guests).toHaveLength(1);
    expect(guests[0].name).toBe("Alice");
    expect(guests[0].plusOnes).toHaveLength(1);
    expect(guests[0].plusOnes[0].name).toBe("Bob");
    expect(guests[0].plusOnes[0].isPlusOne).toBe(true);
  });

  it("normalizes statuses", () => {
    const input = csv(
      "A,Can't Go,,,",
      "B,Invited,,,",
      "C,Pending,,,",
      "D,Approved,,,"
    );
    const guests = parseCSV(input);
    const statuses = guests.map((g) => g.status).sort();

    expect(statuses).toEqual(["Approved", "Can't Go", "Invited", "Pending"]);
  });

  it("sorts guests alphabetically", () => {
    const input = csv("Charlie,Approved,,,", "Alice,Approved,,,", "Bob,Approved,,,");
    const guests = parseCSV(input);
    const names = guests.map((g) => g.name);

    expect(names).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("skips rows without a name", () => {
    const input = csv(",Approved,,,", "Alice,Approved,,,");
    const guests = parseCSV(input);

    expect(guests).toHaveLength(1);
    expect(guests[0].name).toBe("Alice");
  });

  it("handles empty CSV", () => {
    const guests = parseCSV(CSV_HEADER);
    expect(guests).toEqual([]);
  });

  it("uses fullName when different from name", () => {
    const input = csv("Ali,Approved,,Alice Johnson,");
    const guests = parseCSV(input);

    expect(guests[0].fullName).toBe("Alice Johnson");
  });

  it("omits fullName when it matches name", () => {
    const input = csv("Alice,Approved,,Alice,");
    const guests = parseCSV(input);

    expect(guests[0].fullName).toBeUndefined();
  });

  it("defaults unknown statuses to Approved", () => {
    const input = csv("Alice,SomeWeirdStatus,,,");
    const guests = parseCSV(input);

    expect(guests[0].status).toBe("Approved");
  });
});
