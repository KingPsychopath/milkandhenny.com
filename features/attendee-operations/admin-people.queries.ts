import { queryOptions } from "@tanstack/react-query";
import { searchAdminPeopleFn } from "./admin-people.functions";

export const adminPeopleQuery = (search: string) =>
  queryOptions({
    queryKey: ["admin", "operations", "people", search] as const,
    queryFn: () => searchAdminPeopleFn({ data: { search } }),
    staleTime: 10_000,
    retry: false,
  });
