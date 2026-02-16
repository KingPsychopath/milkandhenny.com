import { describe, it, expect } from "vitest";
import { formatBytes } from "@/lib/shared/format";

describe("formatBytes", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 100)).toBe("100.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 5.5)).toBe("5.5 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
    expect(formatBytes(1024 * 1024 * 1024 * 2.75)).toBe("2.75 GB");
  });

  it("formats boundary values correctly", () => {
    // Just under 1 KB
    expect(formatBytes(1023)).toBe("1023 B");
    // Exactly 1 KB
    expect(formatBytes(1024)).toBe("1.0 KB");
    // Just under 1 MB
    expect(formatBytes(1024 * 1024 - 1)).toBe("1024.0 KB");
    // Exactly 1 MB
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });
});
