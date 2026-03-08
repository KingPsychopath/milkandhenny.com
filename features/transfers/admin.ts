import "server-only";

import { getTransferMediaQueueLength } from "./media-queue";
import { getTransferMediaWorkerStatus } from "./media-worker-status";
import { deleteObjects, listObjects } from "@/lib/platform/r2";
import { deleteTransferData, getTransfer, listTransfers } from "./store";

const SAFE_TRANSFER_ID = /^[A-Za-z0-9-]+$/;

function isSafeTransferId(id: string): boolean {
  return SAFE_TRANSFER_ID.test(id);
}

async function listAdminTransfers() {
  return listTransfers();
}

async function getAdminTransferMediaStats() {
  const [queueLength, worker] = await Promise.all([
    getTransferMediaQueueLength().catch(() => 0),
    getTransferMediaWorkerStatus().catch(() => ({})),
  ]);

  return {
    queueLength,
    worker,
  };
}

async function getAdminTransfer(id: string) {
  if (!isSafeTransferId(id)) {
    throw new Error("Invalid transfer id");
  }
  return getTransfer(id);
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

export { isSafeTransferId, listAdminTransfers, getAdminTransfer, getAdminTransferMediaStats, adminDeleteTransfer };
