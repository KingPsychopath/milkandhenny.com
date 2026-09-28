import { listAlertDeliveries, listAlertRecipients } from "./notifications.server";

export async function getAdminAlertSettings() {
  const [recipients, deliveries] = await Promise.all([
    listAlertRecipients(),
    listAlertDeliveries(),
  ]);
  return { recipients, deliveries };
}
