import { queryOptions } from "@tanstack/react-query";
import { getHomePageFn } from "./home.functions";

export const homePageQuery = queryOptions({
  queryKey: ["site", "home"] as const,
  queryFn: () => getHomePageFn(),
  staleTime: 15_000,
});
