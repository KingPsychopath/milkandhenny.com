import { createServerFn } from "@tanstack/react-start";

import { getSystemCapabilities } from "./capabilities.server";

export const getSystemCapabilitiesFn = createServerFn({ method: "GET" }).handler(() =>
  getSystemCapabilities(),
);
