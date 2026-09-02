import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  TransferRecoveryPanel,
  type RecoveryCheckStatus,
} from "@/features/transfers/ui/upload/TransferRecoveryPanel";
import type {
  RecoverySelectionState,
  TransferUploadRecovery,
} from "@/features/transfers/ui/upload/recovery";

const recovery: TransferUploadRecovery = {
  version: 1,
  createdAt: Date.now(),
  transferId: "velvet-moon-candle",
  deleteToken: "secret",
  title: "club photos",
  expiry: "7d",
  expiresSeconds: 604_800,
  sourceFiles: [
    {
      name: "photos.zip",
      size: 150_000_000,
      type: "application/zip",
      lastModified: 123,
    },
  ],
  files: [{ name: "photos.zip", size: 150_000_000, type: "application/zip" }],
};

function renderPanel(
  checkStatus: RecoveryCheckStatus,
  selectionState: RecoverySelectionState = "missing",
  isOnline = true,
) {
  return renderToStaticMarkup(
    createElement(TransferRecoveryPanel, {
      recovery,
      checkStatus,
      selectionState,
      uploadedNames: [],
      isOnline,
      onChooseFiles: () => undefined,
      onContinue: () => undefined,
      onCheckAgain: () => undefined,
      onDiscard: () => undefined,
    }),
  );
}

describe("transfer recovery panel", () => {
  it("gives one clear action when the original files are needed", () => {
    const html = renderPanel("available");
    expect(html).toContain("unfinished transfer found");
    expect(html).toContain("choose files to continue");
    expect(html).toContain("photos.zip");
    expect(html).toContain("143.1 mb");
    expect(html).toContain("no complete files yet");
    expect(html).toContain("143.1 mb still to send");
    expect(html).toContain("send again");
    expect(html).toContain("0%");
  });

  it("explains mismatched selections without implying data loss", () => {
    const html = renderPanel("available", "mismatch");
    expect(html).toContain("these aren’t the same files");
    expect(html).toContain("Nothing has been overwritten");
    expect(html).toContain("choose again");
  });

  it("distinguishes offline, finishing, and expired recovery", () => {
    expect(renderPanel("available", "matches", false)).toContain(
      "upload paused while you’re offline",
    );
    expect(renderPanel("finishing")).toContain("all files received · finishing now");
    expect(renderPanel("expired")).toContain("discard and start new");
    expect(renderPanel("discarding")).toContain("Removing safely stored parts");
  });

  it("shows safely stored progress and a direct continue action", () => {
    const html = renderToStaticMarkup(
      createElement(TransferRecoveryPanel, {
        recovery,
        checkStatus: "available",
        selectionState: "matches",
        uploadedNames: ["photos.zip"],
        isOnline: true,
        onChooseFiles: () => undefined,
        onContinue: () => undefined,
        onCheckAgain: () => undefined,
        onDiscard: () => undefined,
      }),
    );

    expect(html).toContain("1 of 1 files complete");
    expect(html).toContain("100%");
    expect(html).toContain("continue upload");
    expect(html).toContain("An interrupted file restarts when reselected");
  });

  it("allows the stale checkpoint to be discarded while checking", () => {
    const html = renderPanel("checking");
    expect(html).toContain("choose files to continue");
    expect(html).toContain("discard unfinished transfer");
    expect(html).toContain("its upload reservation, and any parts already stored");
  });
});
