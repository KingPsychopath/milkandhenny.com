import { describe, expect, it } from "vitest";

describe("collectDroppedFiles", () => {
  it("recursively collects files from dropped folders", async () => {
    const leaf = new File(["hello"], "photo.jpg", { type: "image/jpeg" });
    const nested = new File(["world"], "clip.mp4", { type: "video/mp4" });

    const nestedDirEntry = {
      isFile: false,
      isDirectory: true,
      createReader() {
        let readCount = 0;
        return {
          readEntries(success: (entries: Array<unknown>) => void) {
            readCount += 1;
            if (readCount === 1) {
              success([
                {
                  isFile: true,
                  isDirectory: false,
                  file(success: (file: File) => void) {
                    success(nested);
                  },
                },
              ]);
              return;
            }
            success([]);
          },
        };
      },
    };

    const rootDirEntry = {
      isFile: false,
      isDirectory: true,
      createReader() {
        let readCount = 0;
        return {
          readEntries(success: (entries: Array<unknown>) => void) {
            readCount += 1;
            if (readCount === 1) {
              success([
                {
                  isFile: true,
                  isDirectory: false,
                  file(success: (file: File) => void) {
                    success(leaf);
                  },
                },
                nestedDirEntry,
              ]);
              return;
            }
            success([]);
          },
        };
      },
    };

    const dropped = await import("@/app/(utility)/upload/drop-files");
    const files = await dropped.collectDroppedFiles({
      items: [
        {
          kind: "file",
          getAsFile: () => null,
          webkitGetAsEntry: () => rootDirEntry,
        },
      ],
      files: [],
    } as unknown as DataTransfer);

    expect(files).toHaveLength(2);
    expect(files.map((file) => file.name)).toEqual(["photo.jpg", "clip.mp4"]);
  });
});
