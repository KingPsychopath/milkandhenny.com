import { describe, it, expect } from "vitest";
import { parseExpiry, formatDuration } from "@/lib/transfers/store";

describe("parseExpiry", () => {
  it("parses minutes", () => {
    expect(parseExpiry("30m")).toBe(1800);
    expect(parseExpiry("1m")).toBe(60);
  });

  it("parses hours", () => {
    expect(parseExpiry("1h")).toBe(3600);
    expect(parseExpiry("12h")).toBe(43200);
  });

  it("parses days", () => {
    expect(parseExpiry("1d")).toBe(86400);
    expect(parseExpiry("7d")).toBe(604800);
    expect(parseExpiry("30d")).toBe(2592000);
  });

  it("is case-insensitive", () => {
    expect(parseExpiry("7D")).toBe(604800);
    expect(parseExpiry("12H")).toBe(43200);
    expect(parseExpiry("30M")).toBe(1800);
  });

  it("trims whitespace", () => {
    expect(parseExpiry("  7d  ")).toBe(604800);
  });

  it("throws for invalid format", () => {
    expect(() => parseExpiry("abc")).toThrow("Invalid expiry format");
    expect(() => parseExpiry("")).toThrow("Invalid expiry format");
    expect(() => parseExpiry("7")).toThrow("Invalid expiry format");
    expect(() => parseExpiry("7x")).toThrow("Invalid expiry format");
  });

  it("throws for expiry exceeding 30 days", () => {
    expect(() => parseExpiry("31d")).toThrow("cannot exceed 30 days");
  });
});

describe("formatDuration", () => {
  it("returns 'expired' for zero or negative seconds", () => {
    expect(formatDuration(0)).toBe("expired");
    expect(formatDuration(-100)).toBe("expired");
  });

  it("formats minutes only (under 1 hour, no days)", () => {
    expect(formatDuration(300)).toBe("5m");
    expect(formatDuration(59 * 60)).toBe("59m");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3660)).toBe("1h 1m");
    expect(formatDuration(7200)).toBe("2h");
  });

  it("formats days and hours", () => {
    expect(formatDuration(90000)).toBe("1d 1h");
    expect(formatDuration(86400)).toBe("1d");
  });

  it("drops minutes when days are present", () => {
    // 1d + 1h + 30m → should show "1d 1h" (minutes hidden when days present)
    expect(formatDuration(86400 + 3600 + 1800)).toBe("1d 1h");
  });

  it("returns '< 1m' for very small durations", () => {
    expect(formatDuration(30)).toBe("< 1m");
    expect(formatDuration(1)).toBe("< 1m");
  });
});
