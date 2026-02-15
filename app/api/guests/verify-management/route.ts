import { NextRequest } from "next/server";
import { handleVerifyRequest } from "@/lib/auth";

/** POST /api/guests/verify-management — rate-limited, timing-safe. */
export async function POST(request: NextRequest) {
  return handleVerifyRequest(request, "admin");
}
