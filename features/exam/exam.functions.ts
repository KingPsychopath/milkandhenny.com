import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";

import { unlockExamAnswers } from "./exam.server";

export const unlockExamAnswersFn = createServerFn({ method: "POST" })
  .validator((data: { pin: string }) => ({ pin: String(data.pin ?? "").slice(0, 64) }))
  .handler(({ data }) => unlockExamAnswers(data.pin, getRequestIP() || "unknown"));
