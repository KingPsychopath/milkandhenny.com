import { personHasAccountPermission } from "@/features/attendee-access/account-permissions.server";
import {
  getAttendeeSession,
  getAttendeeSessionForRequest,
  type AttendeeSession,
} from "@/features/attendee-access/session.server";
import { requireAuthWithPayload } from "@/features/auth/auth.server";
import { getTransfer } from "./store.server";

export type TransferUploadAccess = {
  actorJti: string;
  isAdmin: boolean;
  ownerPersonId?: string;
};

async function accountUploadAccess(
  session: AttendeeSession | null,
): Promise<TransferUploadAccess | null> {
  if (
    !session?.personId ||
    !(await personHasAccountPermission(session.personId, "create_transfers"))
  ) {
    return null;
  }
  return {
    actorJti: `account:${session.id}`,
    isAdmin: false,
    ownerPersonId: session.personId,
  };
}

export async function transferUploadAccessForCurrentAccount(): Promise<TransferUploadAccess | null> {
  return accountUploadAccess(await getAttendeeSession());
}

export async function requireTransferUploadAccess(
  request: Request,
): Promise<{ access: TransferUploadAccess; error: null } | { access: null; error: Response }> {
  const legacy = await requireAuthWithPayload(request, "upload");
  if (!legacy.error && legacy.payload?.jti && legacy.payload.role === "admin") {
    return {
      access: {
        actorJti: legacy.payload.jti,
        isAdmin: true,
      },
      error: null,
    };
  }
  let account: TransferUploadAccess | null = null;
  try {
    account = await accountUploadAccess(await getAttendeeSessionForRequest(request));
  } catch {
    // The legacy upload credential remains an independent fallback.
  }
  if (account) return { access: account, error: null };
  if (!legacy.error && legacy.payload?.jti) {
    return {
      access: { actorJti: legacy.payload.jti, isAdmin: false },
      error: null,
    };
  }
  return {
    access: null,
    error:
      legacy.error ??
      Response.json({ error: "Authenticated upload session is missing an ID" }, { status: 401 }),
  };
}

export async function requestOwnsTransfer(request: Request, transferId: string): Promise<boolean> {
  const session = await getAttendeeSessionForRequest(request);
  if (!session?.personId) return false;
  const transfer = await getTransfer(transferId);
  return transfer?.ownerPersonId === session.personId;
}

export async function currentAccountOwnsTransfer(transferId: string): Promise<boolean> {
  const session = await getAttendeeSession();
  if (!session?.personId) return false;
  const transfer = await getTransfer(transferId);
  return transfer?.ownerPersonId === session.personId;
}
