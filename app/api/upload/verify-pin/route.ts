import { NextRequest } from "next/server";
import { handleVerifyRequest } from "@/features/auth/server";

/** POST /api/upload/verify-pin — rate-limited, timing-safe upload gate. */
export async function POST(request: NextRequest) {
  return handleVerifyRequest(request, "upload");
}
