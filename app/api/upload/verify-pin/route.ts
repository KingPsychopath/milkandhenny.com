import { NextRequest } from "next/server";
import { handleVerifyRequest } from "@/lib/auth";

/** POST /api/upload/verify-pin — rate-limited, timing-safe upload gate. */
export async function POST(request: NextRequest) {
  return handleVerifyRequest(request, "upload");
}
