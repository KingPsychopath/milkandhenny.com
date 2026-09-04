import {
  listCommunicationContacts,
  listCommunicationEvents,
  listCommunicationMessages,
} from "./communications.server";
import { listCommunicationPlans, listCommunicationTemplates } from "./communication-plans.server";
import { listSurveys } from "@/features/surveys/surveys.server";
import { describeEmailCapability } from "@/lib/platform/email.server";
import { query } from "@/lib/platform/postgres.server";

export type CommunicationsWorkspaceInput = {
  tab?: string;
  eventSlug?: string;
  query?: string;
  cursor?: string;
};

/** Reads only the selected job. Reconciliation belongs to send workflows, never opening an admin page. */
export async function readCommunicationsWorkspace(input: CommunicationsWorkspaceInput) {
  const tab = input.tab ?? "event-plan";
  const needsEvents = ["event-plan", "compose", "feedback", "polls"].includes(tab);
  const events = needsEvents ? await listCommunicationEvents() : [];
  const selectedEvent =
    input.eventSlug ||
    events.find((event) => event.startsAt && Date.parse(event.startsAt) > Date.now())?.slug ||
    events[0]?.slug ||
    "";
  const needsContacts = tab === "people" || tab === "compose";
  const [contacts, messages, plans, templates, surveys, counts] = await Promise.all([
    needsContacts
      ? listCommunicationContacts({
          reconcile: false,
          query: input.query,
          cursor: input.cursor,
          limit: 101,
        })
      : [],
    tab === "delivery" ? listCommunicationMessages() : [],
    tab === "event-plan" && selectedEvent ? listCommunicationPlans(selectedEvent) : [],
    ["event-plan", "templates", "compose"].includes(tab) ? listCommunicationTemplates() : [],
    tab === "feedback" || tab === "event-plan" ? listSurveys() : [],
    needsContacts
      ? query<{ total: number; opted_in: number }>(
          "select count(*)::int as total, count(*) filter(where marketing_opted_in)::int as opted_in from communication_contacts",
        )
      : [],
  ]);
  return {
    contacts: contacts.slice(0, 100).map(({ unsubscribeToken: _token, ...contact }) => contact),
    contactsNextCursor: contacts.length > 100 ? (contacts[99]?.emailHash ?? null) : null,
    contactTotal: counts[0]?.total ?? 0,
    optedInCount: counts[0]?.opted_in ?? 0,
    messages,
    events,
    plans,
    templates,
    surveys,
    selectedEvent,
    email: describeEmailCapability(),
    checkedAt: new Date().toISOString(),
  };
}
