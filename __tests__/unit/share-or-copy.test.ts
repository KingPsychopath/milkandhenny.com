import { afterEach, describe, expect, it, vi } from "vitest";

import { shareOrCopy } from "@/lib/client/share";

const invite = {
  title: "Twin",
  text: "Join room ABC123.",
  url: "https://example.test/twin/ABC123",
};

/**
 * `pointer: coarse` is the phone; a laptop matches neither query. Desktop browsers do expose
 * `navigator.share`, so the pointer is the only thing that separates the two here.
 */
function stubBrowser({ coarsePointer }: { coarsePointer: boolean }) {
  const share = vi.fn(async () => undefined);
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({ matches: coarsePointer && query.includes("coarse") }),
  });
  vi.stubGlobal("navigator", { share, clipboard: { writeText } });
  return { share, writeText };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shareOrCopy", () => {
  it("copies on desktop rather than opening a share sheet nobody can see", async () => {
    const { share, writeText } = stubBrowser({ coarsePointer: false });

    await expect(shareOrCopy(invite, { copyValue: invite.url })).resolves.toBe("copied");
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(invite.url);
  });

  it("opens the share sheet on a phone", async () => {
    const { share, writeText } = stubBrowser({ coarsePointer: true });

    await expect(shareOrCopy(invite, { copyValue: invite.url })).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith(invite);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("reports a dismissed share sheet as cancelled, without copying behind the host's back", async () => {
    const { share, writeText } = stubBrowser({ coarsePointer: true });
    share.mockRejectedValueOnce(new DOMException("cancelled", "AbortError"));

    await expect(shareOrCopy(invite, { copyValue: invite.url })).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when the share sheet fails outright", async () => {
    const { share, writeText } = stubBrowser({ coarsePointer: true });
    share.mockRejectedValueOnce(new DOMException("no", "NotAllowedError"));

    await expect(shareOrCopy(invite, { copyValue: invite.url })).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(invite.url);
  });
});
