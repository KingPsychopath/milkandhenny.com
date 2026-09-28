import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import {
  getAdminTransfer,
  getAdminTransferMediaStats,
  isSafeTransferId,
  listAdminTransfers,
} from "./admin.server";

async function requireTransferAdminAccess() {
  const access = await getAdminWorkspaceAccess(getRequest());
  if (!access.ok || !access.permissions.manageContent)
    throw new Error("Transfer management access required");
}

export const getAdminTransfersFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireTransferAdminAccess();
  const [transfers, media] = await Promise.all([
    listAdminTransfers(),
    getAdminTransferMediaStats(),
  ]);
  return { transfers, media };
});

export const getAdminTransferFn = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => ({ id: data.id.slice(0, 128) }))
  .handler(async ({ data }) => {
    await requireTransferAdminAccess();
    if (!isSafeTransferId(data.id)) throw new Error("Invalid transfer id");
    const transfer = await getAdminTransfer(data.id);
    if (!transfer) throw new Error("Transfer not found");
    return transfer;
  });
