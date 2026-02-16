import { NextRequest } from "next/server";
import { handleVerifyRequest } from "@/features/auth/server";

/** POST /api/guests/verify-staff-pin — rate-limited, timing-safe. */
export async function POST(request: NextRequest) {
  return handleVerifyRequest(request, "staff");
}
