import { createServerFn } from "@tanstack/react-start";

import { resolveDropToken } from "./drop.server";

/**
 * Loader boundary for the guest drop page. The token is the credential;
 * a dead link resolves to `found: false` and nothing else leaks.
 */
export type DropPageResult =
  | { found: false }
  | {
      found: true;
      token: string;
      eventTitle: string;
      expiresAt: string;
      fileCount: number;
      /** The shared album — browsable before uploading anything. */
      albumPath: string;
    };

export const getDropPageFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }): Promise<DropPageResult> => {
    const drop = await resolveDropToken(data.token);
    if (!drop) return { found: false };
    return {
      found: true,
      token: data.token,
      eventTitle: drop.eventTitle,
      expiresAt: drop.expiresAt,
      fileCount: drop.fileCount,
      albumPath: `/t/${drop.transferId}`,
    };
  });
