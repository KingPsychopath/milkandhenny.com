import { createServerFn } from "@tanstack/react-start";

import { toPublicTransfer } from "./public";
import { getTransfer, validateDeleteToken } from "./store.server";

export const getTransferPageFn = createServerFn({ method: "GET" })
  .validator((data: { id: string; token?: string }) => data)
  .handler(async ({ data }) => {
    const transfer = await getTransfer(data.id);
    const remainingSeconds = transfer
      ? Math.floor((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000)
      : 0;
    const canDelete = data.token ? await validateDeleteToken(data.id, data.token) : false;
    return {
      transfer: transfer ? toPublicTransfer(transfer) : null,
      remainingSeconds,
      canDelete,
    };
  });
