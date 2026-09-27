import { queryOptions } from "@tanstack/react-query";
import { getAdminEmailLedgerFn } from "./admin-ledger.functions";
import type { EmailLedgerQuery } from "./types";

export const adminEmailLedgerQuery = (filters: EmailLedgerQuery) =>
  queryOptions({
    queryKey: ["admin", "email", "ledger", filters] as const,
    queryFn: () => getAdminEmailLedgerFn({ data: filters }),
    staleTime: 5_000,
    retry: false,
  });
