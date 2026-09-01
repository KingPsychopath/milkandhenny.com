import { createServerFn } from "@tanstack/react-start";

import { eventNightContexts } from "./event-night.server";

export const getEventNightContextsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return await eventNightContexts();
  } catch {
    // Event navigation is recovery chrome; a temporary read failure must not take down the page.
    return [];
  }
});
