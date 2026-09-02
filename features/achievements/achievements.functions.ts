import { createServerFn } from "@tanstack/react-start";

import { getAttendeeSession } from "@/features/attendee-access/session.server";
import {
  listPersonAchievementNotifications,
  markPersonAchievementNotificationsDelivered,
} from "./achievements.server";

export const getAchievementNotificationsFn = createServerFn({ method: "GET" }).handler(async () => {
  const personId = (await getAttendeeSession())?.personId;
  return personId ? listPersonAchievementNotifications(personId) : [];
});

export const markAchievementNotificationsDeliveredFn = createServerFn({ method: "POST" })
  .validator((data: { notificationIds: string[] }) => data)
  .handler(async ({ data }) => {
    const personId = (await getAttendeeSession())?.personId;
    if (!personId) return 0;
    return markPersonAchievementNotificationsDelivered(
      personId,
      data.notificationIds.filter((id) => typeof id === "string").slice(0, 50),
    );
  });
