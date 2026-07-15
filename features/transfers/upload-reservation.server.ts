import { getRedis } from "@/lib/platform/redis.server";
import type { TransferUploadFileInput } from "./upload-types";

const RESERVATION_PREFIX = "transfer:upload-reservation:";
const RESERVATION_TTL_SECONDS = 15 * 60;

type TransferUploadReservation = {
  transferId: string;
  deleteToken: string;
  actorJti: string;
  expiresSeconds: number;
  filesFingerprint: string;
  createdAt: string;
};

const memoryReservations = new Map<string, TransferUploadReservation>();

function allowInMemoryReservations(): boolean {
  return process.env.NODE_ENV === "test" || process.env.ALLOW_IN_MEMORY_TRANSFER_STORE === "1";
}

function requireReservationRedis() {
  const redis = getRedis();
  if (redis) return redis;
  if (allowInMemoryReservations()) return null;
  throw new Error(
    "Transfer upload reservations require Redis. Configure REDIS_REST_URL and REDIS_REST_TOKEN.",
  );
}

function reservationKey(transferId: string): string {
  return `${RESERVATION_PREFIX}${transferId}`;
}

function transferUploadFilesFingerprint(files: TransferUploadFileInput[]): string {
  return JSON.stringify(
    files.map((file) => ({
      mediaId: file.mediaId,
      name: file.name,
      size: file.size,
      type: file.type ?? null,
      originalName: file.originalName ?? null,
      originalSize: file.originalSize ?? null,
      originalType: file.originalType ?? null,
      convertedFrom: file.convertedFrom ?? null,
    })),
  );
}

async function createTransferUploadReservation(
  reservation: TransferUploadReservation,
): Promise<boolean> {
  const redis = requireReservationRedis();
  if (redis) {
    return Boolean(
      await redis.set(reservationKey(reservation.transferId), reservation, {
        ex: RESERVATION_TTL_SECONDS,
        nx: true,
      }),
    );
  }

  const key = reservationKey(reservation.transferId);
  if (memoryReservations.has(key)) return false;
  memoryReservations.set(key, reservation);
  setTimeout(() => memoryReservations.delete(key), RESERVATION_TTL_SECONDS * 1000).unref?.();
  return true;
}

async function getTransferUploadReservation(
  transferId: string,
): Promise<TransferUploadReservation | null> {
  const redis = requireReservationRedis();
  if (redis) {
    const raw = await redis.get<TransferUploadReservation | string>(reservationKey(transferId));
    if (!raw) return null;
    return typeof raw === "string" ? (JSON.parse(raw) as TransferUploadReservation) : raw;
  }
  return memoryReservations.get(reservationKey(transferId)) ?? null;
}

async function deleteTransferUploadReservation(transferId: string): Promise<void> {
  const redis = requireReservationRedis();
  if (redis) {
    await redis.del(reservationKey(transferId));
    return;
  }
  memoryReservations.delete(reservationKey(transferId));
}

export {
  createTransferUploadReservation,
  deleteTransferUploadReservation,
  getTransferUploadReservation,
  transferUploadFilesFingerprint,
};

export type { TransferUploadReservation };
