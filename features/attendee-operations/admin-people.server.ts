import { searchPeople, searchPurchaserContacts } from "./directory.server";

export async function searchAdminPeople(search: string) {
  const [people, purchaserContacts] = await Promise.all([
    searchPeople(search),
    searchPurchaserContacts(search),
  ]);
  return { people, purchaserContacts };
}
