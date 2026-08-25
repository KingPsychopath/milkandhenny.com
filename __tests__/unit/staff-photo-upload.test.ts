import { describe, expect, it, vi } from "vitest";

import { uploadStaffScorePhoto } from "../../features/event-scoring/ui/staff-photo-upload";

const file = new File(["photograph"], "winner.png", { type: "image/png" });

describe("staff score photograph upload", () => {
  it("presigns, uploads, finalizes, and returns an album reference", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          urls: [{ primaryUrl: "https://storage.example/upload", contentType: "image/png" }],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      uploadStaffScorePhoto({
        file,
        uploadPath: "/drop/photo-token?upload=1",
        albumPath: "/events/summer/album",
        request,
        createId: () => "photo-id",
      }),
    ).resolves.toBe("/events/summer/album#score-photo-id.png");

    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://storage.example/upload",
      expect.objectContaining({ method: "PUT", body: file }),
    );
    expect(JSON.parse(String(request.mock.calls[2]?.[1]?.body))).toEqual({
      token: "photo-token",
      files: [{ name: "score-photo-id.png", size: file.size, type: "image/png" }],
    });
  });

  it("rejects missing drop tokens before making a request", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      uploadStaffScorePhoto({ file, uploadPath: "/events/album", request }),
    ).rejects.toThrow("not open");
    expect(request).not.toHaveBeenCalled();
  });

  it("reports each failed upload stage", async () => {
    const presignFailure = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: "Album is full" }, { status: 409 }));
    await expect(
      uploadStaffScorePhoto({ file, uploadPath: "/drop/token", request: presignFailure }),
    ).rejects.toThrow("Album is full");

    const uploadFailure = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          urls: [{ primaryUrl: "https://storage.example/upload", contentType: "image/png" }],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(
      uploadStaffScorePhoto({ file, uploadPath: "/drop/token", request: uploadFailure }),
    ).rejects.toThrow("did not upload");

    const finalizeFailure = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          urls: [{ primaryUrl: "https://storage.example/upload", contentType: "image/png" }],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(
      uploadStaffScorePhoto({ file, uploadPath: "/drop/token", request: finalizeFailure }),
    ).rejects.toThrow("could not be attached");
  });
});
