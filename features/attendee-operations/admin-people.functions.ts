import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { searchAdminPeople } from "./admin-people.server";

export const searchAdminPeopleFn = createServerFn({ method: "GET" })
  .validator((data: { search: string }) => ({ search: data.search.trim().slice(0, 200) }))
  .handler(async ({ data }) => {
    const access = await getAdminWorkspaceAccess(getRequest());
    if (!access.ok || !access.permissions.managePeople)
      throw new Error("People management access required");
    return searchAdminPeople(data.search);
  });
