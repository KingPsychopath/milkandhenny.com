import type {
  GlobalAdminPermission,
  GlobalAdminPermissionSet,
} from "@/features/attendee-operations/types";
import type { AdminDestination, AdminSection, OperationsTab } from "./components/AdminSectionNav";

const SECTION_PERMISSIONS = {
  overview: ["viewOperations"],
  content: ["manageContent"],
  events: [
    "viewOperations",
    "manageEvents",
    "manageTickets",
    "executeRefunds",
    "manageScoring",
    "manageContent",
  ],
  operations: ["viewOperations", "managePeople"],
  communications: ["manageCommunications"],
  games: ["manageScoring"],
  transfers: ["manageContent"],
  "best-dressed": ["manageScoring"],
  system: ["viewOperations"],
  settings: ["manageGlobalSettings"],
} as const satisfies Record<AdminSection, readonly GlobalAdminPermission[]>;

export function hasAnyAdminPermission(
  permissions: GlobalAdminPermissionSet,
  required: readonly GlobalAdminPermission[],
): boolean {
  return required.some((permission) => permissions[permission]);
}

export function canAccessAdminSection(
  section: AdminSection,
  permissions: GlobalAdminPermissionSet,
): boolean {
  return hasAnyAdminPermission(permissions, SECTION_PERMISSIONS[section]);
}

export function canAccessOperationsTab(
  tab: OperationsTab,
  permissions: GlobalAdminPermissionSet,
): boolean {
  return tab === "people" ? permissions.managePeople : permissions.viewOperations;
}

export function canAccessAdminDestination(
  destination: AdminDestination,
  permissions: GlobalAdminPermissionSet,
): boolean {
  if (destination.section !== "operations") {
    return canAccessAdminSection(destination.section, permissions);
  }
  return destination.operationsTab
    ? canAccessOperationsTab(destination.operationsTab, permissions)
    : canAccessAdminSection("operations", permissions);
}

export function firstAccessibleAdminSection(
  sections: readonly AdminSection[],
  permissions: GlobalAdminPermissionSet,
): AdminSection | null {
  return sections.find((section) => canAccessAdminSection(section, permissions)) ?? null;
}

export function firstAccessibleOperationsTab(
  tabs: readonly OperationsTab[],
  permissions: GlobalAdminPermissionSet,
): OperationsTab | null {
  return tabs.find((tab) => canAccessOperationsTab(tab, permissions)) ?? null;
}
