import { NextRequest } from "next/server";
import { handleVerifyRequest } from "@/features/auth/server";

/** POST /api/admin/verify — rate-limited, timing-safe admin verify. */
export async function POST(request: NextRequest) {
  return handleVerifyRequest(request, "admin");
}
