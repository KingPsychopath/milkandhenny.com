import "server-only";

import { deleteObjects, listObjects } from "@/lib/platform/r2";
import { deleteTransferData, listTransfers } from "./store";

const SAFE_TRANSFER_ID = /^[A-Za-z0-9-]+$/;

function isSafeTransferId(id: string): boolean {
  return SAFE_TRANSFER_ID.test(id);
}

async function listAdminTransfers() {
  return listTransfers();
}

async function adminDeleteTransfer(id: string): Promise<{
  deletedFiles: number;
  dataDeleted: boolean;
}> {
  if (!isSafeTransferId(id)) {
    throw new Error("Invalid transfer id");
  }

  const prefix = `transfers/${id}/`;
  const objects = await listObjects(prefix);
  const keys = objects.map((o) => o.key);
  const deletedFiles = keys.length > 0 ? await deleteObjects(keys) : 0;
  const dataDeleted = await deleteTransferData(id);

  return { deletedFiles, dataDeleted };
}

export { isSafeTransferId, listAdminTransfers, adminDeleteTransfer };
