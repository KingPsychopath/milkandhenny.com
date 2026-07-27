import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getUploadReservationTtlSeconds,
  getUploadUrlTtlSeconds,
  MAX_SINGLE_PUT_BYTES,
  RESERVATION_GRACE_SECONDS,
} from "@/features/transfers/upload-window.server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("upload window", () => {
  it("gives a batch hours, not minutes", () => {
    // Every URL in a batch is signed before the first byte moves, so the window
    // has to cover the whole selection. At 15 minutes the later files in a
    // multi-gigabyte upload found their URLs already expired.
    expect(getUploadUrlTtlSeconds()).toBeGreaterThanOrEqual(60 * 60);
  });

  it("keeps the reservation alive longer than the URLs it guards", () => {
    // Otherwise an upload that finishes inside the window has nothing left to
    // finalise against, and every uploaded byte is thrown away.
    expect(getUploadReservationTtlSeconds()).toBe(
      getUploadUrlTtlSeconds() + RESERVATION_GRACE_SECONDS,
    );
  });

  it("keeps that relationship when the window is overridden", () => {
    vi.stubEnv("TRANSFER_UPLOAD_URL_TTL_SECONDS", "3600");

    expect(getUploadUrlTtlSeconds()).toBe(3600);
    expect(getUploadReservationTtlSeconds()).toBeGreaterThan(3600);
  });

  it("ignores a nonsense override rather than minting dead URLs", () => {
    for (const bad of ["0", "-1", "soon", ""]) {
      vi.stubEnv("TRANSFER_UPLOAD_URL_TTL_SECONDS", bad);
      expect(getUploadUrlTtlSeconds()).toBeGreaterThanOrEqual(60 * 60);
    }
  });

  it("caps a single PUT at what object storage will actually accept", () => {
    // 5 GiB is the S3/R2 single-object limit. We do not implement multipart, so
    // anything larger cannot be uploaded at all — better a clear rejection up
    // front than hours of transfer ending in EntityTooLarge.
    expect(MAX_SINGLE_PUT_BYTES).toBe(5 * 1024 * 1024 * 1024);
  });
});
