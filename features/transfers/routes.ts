import { buildAppUrl } from "@/lib/shared/app-url";

export function transferPath(transferId: string) {
  return `/t/${encodeURIComponent(transferId)}`;
}

export function buildTransferUrl(origin: string, transferId: string, deleteToken?: string) {
  return buildAppUrl(origin, transferPath(transferId), {
    search: deleteToken ? { token: deleteToken } : undefined,
  });
}
