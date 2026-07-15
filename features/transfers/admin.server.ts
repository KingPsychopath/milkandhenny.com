import { getTransferMediaQueueLength } from "./media-queue.server";
import { getTransferMediaWorkerStatus } from "./media-worker-status.server";
import { deleteObjects, listObjects } from "@/lib/platform/r2.server";
import { deleteTransferData, getTransfer, listTransfers } from "./store.server";
import type { TransferData } from "./types";

const SAFE_TRANSFER_ID = /^[A-Za-z0-9_-]+$/;

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

type AdminTransferDetail = Omit<TransferData, "deleteToken">;

async function getAdminTransfer(id: string): Promise<AdminTransferDetail | null> {
  if (!isSafeTransferId(id)) {
    throw new Error("Invalid transfer id");
  }
  const transfer = await getTransfer(id);
  if (!transfer) return null;
  return {
    id: transfer.id,
    title: transfer.title,
    files: transfer.files,
    groups: transfer.groups,
    createdAt: transfer.createdAt,
    expiresAt: transfer.expiresAt,
  };
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

export {
  isSafeTransferId,
  listAdminTransfers,
  getAdminTransfer,
  getAdminTransferMediaStats,
  adminDeleteTransfer,
};

export type { AdminTransferDetail };
