import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { toPublicTransfer } from "./public";
import { getTransfer, validateDeleteToken } from "./store.server";
import { currentAccountOwnsTransfer } from "./upload-access.server";

export const getTransferOwnerAccessFn = createServerFn({ method: "GET" })
  .validator((data: { id: string; token: string }) => data)
  .handler(({ data }) => validateDeleteToken(data.id, data.token));

export const getTransferAccountOwnerAccessFn = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(({ data }) => currentAccountOwnsTransfer(data.id));

export const getTransferPageFn = createServerFn({ method: "GET" })
  .validator((data: { id: string; token?: string }) => data)
  .handler(async ({ data }) => {
    const transfer = await getTransfer(data.id);
    const remainingSeconds = transfer
      ? Math.floor((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000)
      : 0;
    const ownerAccess = data.token ? await validateDeleteToken(data.id, data.token) : false;
    const accountOwnerAccess =
      transfer && !ownerAccess ? await currentAccountOwnsTransfer(data.id) : false;
    const adminAccess =
      transfer && !ownerAccess && !accountOwnerAccess
        ? await getAdminWorkspaceAccess(getRequest())
        : null;
    const managementMode = ownerAccess
      ? ("owner" as const)
      : accountOwnerAccess
        ? ("account" as const)
        : adminAccess?.ok && adminAccess.permissions.manageContent
          ? ("admin" as const)
          : null;
    return {
      transfer: transfer ? toPublicTransfer(transfer) : null,
      remainingSeconds,
      managementMode,
    };
  });
