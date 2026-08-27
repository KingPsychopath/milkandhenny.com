import { Context, Layer } from "effect";

import * as assets from "./assets.server";
import * as engine from "./pitches.server";
import * as presentation from "./presentation.server";
import * as reminders from "./reminders.server";
import * as store from "./store.server";
import { pitchesOperation } from "./pitches-operation.server";

export class PitchesService extends Context.Service<
  PitchesService,
  {
    readonly create: typeof create;
    readonly readOwned: typeof readOwned;
    readonly readOwnedStatus: typeof readOwnedStatus;
    readonly restoreFromTrash: typeof restoreFromTrash;
    readonly listForPerson: typeof listForPerson;
    readonly openForPerson: typeof openForPerson;
    readonly listHistory: typeof listHistory;
    readonly readVersion: typeof readVersion;
    readonly restoreVersion: typeof restoreVersion;
    readonly sync: typeof sync;
    readonly publish: typeof publish;
    readonly listPublished: typeof listPublished;
    readonly readPublished: typeof readPublished;
    readonly recover: typeof recover;
    readonly allowRecovery: typeof allowRecovery;
    readonly createAssetUpload: typeof createAssetUpload;
    readonly finaliseAsset: typeof finaliseAsset;
    readonly cleanup: typeof cleanup;
    readonly listAdmin: typeof listAdmin;
    readonly readAdmin: typeof readAdmin;
    readonly adminDetail: typeof adminDetail;
    readonly archive: typeof archive;
    readonly adminAssets: typeof adminAssets;
    readonly updateAdmin: typeof updateAdmin;
    readonly restoreAdmin: typeof restoreAdmin;
    readonly resendAdmin: typeof resendAdmin;
    readonly deleteAdmin: typeof deleteAdmin;
    readonly restoreTrashAdmin: typeof restoreTrashAdmin;
    readonly reminderAdmin: typeof reminderAdmin;
    readonly updateReminderSettings: typeof updateReminderSettings;
    readonly sendReminderWave: typeof sendReminderWave;
    readonly runAutomaticReminders: typeof runAutomaticReminders;
    readonly createPresentation: typeof createPresentation;
    readonly joinPresentation: typeof joinPresentation;
    readonly readPresentation: typeof readPresentation;
    readonly approveController: typeof approveController;
    readonly controlPresentation: typeof controlPresentation;
  }
>()("PitchesService") {
  static readonly layer = Layer.succeed(this, {
    create,
    readOwned,
    readOwnedStatus,
    restoreFromTrash,
    listForPerson,
    openForPerson,
    listHistory,
    readVersion,
    restoreVersion,
    sync,
    publish,
    listPublished,
    readPublished,
    recover,
    allowRecovery,
    createAssetUpload,
    finaliseAsset,
    cleanup,
    listAdmin,
    readAdmin,
    adminDetail,
    archive,
    adminAssets,
    updateAdmin,
    restoreAdmin,
    resendAdmin,
    deleteAdmin,
    restoreTrashAdmin,
    reminderAdmin,
    updateReminderSettings,
    sendReminderWave,
    runAutomaticReminders,
    createPresentation,
    joinPresentation,
    readPresentation,
    approveController,
    controlPresentation,
  });
}

function create(input: Parameters<typeof engine.createPitch>[0]) {
  return pitchesOperation("create", () => engine.createPitch(input), {
    access: "write",
    timeoutMs: false,
  });
}

function readOwned(...input: Parameters<typeof engine.readOwnedPitch>) {
  return pitchesOperation("read_owned", () => engine.readOwnedPitch(...input), { access: "read" });
}

function readOwnedStatus(...input: Parameters<typeof engine.readOwnedPitchStatus>) {
  return pitchesOperation("read_owned_status", () => engine.readOwnedPitchStatus(...input), {
    access: "read",
  });
}

function restoreFromTrash(...input: Parameters<typeof engine.restoreOwnedPitchFromTrash>) {
  return pitchesOperation(
    "owner_restore_trash",
    () => engine.restoreOwnedPitchFromTrash(...input),
    { access: "write" },
  );
}

function listForPerson(personId: string) {
  return pitchesOperation("list_for_person", () => engine.listPitchDecksForPerson(personId), {
    access: "read",
  });
}

function openForPerson(...input: Parameters<typeof engine.openPitchForPerson>) {
  return pitchesOperation("open_for_person", () => engine.openPitchForPerson(...input), {
    access: "read",
  });
}

function listHistory(...input: Parameters<typeof engine.listPitchHistory>) {
  return pitchesOperation("list_history", () => engine.listPitchHistory(...input), {
    access: "read",
  });
}

function readVersion(...input: Parameters<typeof engine.readPitchVersion>) {
  return pitchesOperation("read_version", () => engine.readPitchVersion(...input), {
    access: "read",
  });
}

function restoreVersion(...input: Parameters<typeof engine.restorePitchVersion>) {
  return pitchesOperation("restore_version", () => engine.restorePitchVersion(...input), {
    access: "write",
  });
}

function sync(input: Parameters<typeof engine.syncPitch>[0]) {
  return pitchesOperation("sync", () => engine.syncPitch(input), { access: "write" });
}

function publish(input: Parameters<typeof engine.publishPitch>[0]) {
  return pitchesOperation("publish", () => engine.publishPitch(input), {
    access: "write",
    timeoutMs: false,
  });
}

function listPublished(search?: string) {
  return pitchesOperation("list_published", () => engine.listPublishedPitches(search), {
    access: "read",
  });
}

function readPublished(deckId: string, editionNumber?: number) {
  return pitchesOperation(
    "read_published",
    () => engine.readPublishedPitch(deckId, editionNumber),
    {
      access: "read",
    },
  );
}

function recover(input: Parameters<typeof engine.recoverPitchAccess>[0]) {
  return pitchesOperation("recover_access", () => engine.recoverPitchAccess(input), {
    access: "write",
    timeoutMs: false,
  });
}

function allowRecovery(ip: string, email: string) {
  return pitchesOperation("allow_recovery", () => engine.allowPitchRecovery(ip, email), {
    access: "write",
  });
}

function createAssetUpload(input: Parameters<typeof engine.createPitchAssetUpload>[0]) {
  return pitchesOperation("create_asset_upload", () => engine.createPitchAssetUpload(input), {
    access: "write",
  });
}

function finaliseAsset(input: Parameters<typeof engine.finalisePitchAsset>[0]) {
  return pitchesOperation("finalise_asset", () => engine.finalisePitchAsset(input), {
    access: "write",
    timeoutMs: false,
  });
}

function cleanup(limit?: number) {
  return pitchesOperation("cleanup", () => engine.cleanupExpiredPitches(limit), {
    access: "maintenance",
    timeoutMs: false,
  });
}

function listAdmin() {
  return pitchesOperation("admin_list", () => store.listPitchDecksForAdmin(), { access: "admin" });
}

function readAdmin(deckId: string) {
  return pitchesOperation("admin_read", () => store.readPitchDeckForAdmin(deckId), {
    access: "admin",
  });
}

function adminDetail(deckId: string) {
  return pitchesOperation("admin_detail", () => engine.readPitchForAdmin(deckId), {
    access: "admin",
  });
}

function archive(deckId: string, archived: boolean) {
  return pitchesOperation("admin_archive", () => store.setPitchDeckArchived(deckId, archived), {
    access: "write",
  });
}

function adminAssets(deckId: string) {
  return pitchesOperation("admin_assets", () => assets.signedPitchAssets(deckId), {
    access: "admin",
  });
}

function updateAdmin(input: Parameters<typeof engine.updatePitchForAdmin>[0]) {
  return pitchesOperation("admin_update", () => engine.updatePitchForAdmin(input), {
    access: "write",
  });
}

function restoreAdmin(...input: Parameters<typeof engine.restorePitchForAdmin>) {
  return pitchesOperation("admin_restore_backup", () => engine.restorePitchForAdmin(...input), {
    access: "write",
  });
}

function resendAdmin(input: Parameters<typeof engine.resendPitchAccessForAdmin>[0]) {
  return pitchesOperation("admin_resend", () => engine.resendPitchAccessForAdmin(input), {
    access: "write",
    timeoutMs: false,
  });
}

function deleteAdmin(...input: Parameters<typeof engine.deletePitchForAdmin>) {
  return pitchesOperation("admin_delete", () => engine.deletePitchForAdmin(...input), {
    access: "admin",
    timeoutMs: false,
  });
}

function restoreTrashAdmin(...input: Parameters<typeof engine.restorePitchFromTrashForAdmin>) {
  return pitchesOperation(
    "admin_restore_trash",
    () => engine.restorePitchFromTrashForAdmin(...input),
    { access: "write" },
  );
}

function reminderAdmin() {
  return pitchesOperation("admin_reminder_read", () => reminders.readPitchReminderAdmin(), {
    access: "admin",
  });
}

function updateReminderSettings(
  input: Parameters<typeof reminders.updatePitchReminderSettings>[0],
) {
  return pitchesOperation(
    "admin_reminder_settings",
    () => reminders.updatePitchReminderSettings(input),
    { access: "admin" },
  );
}

function sendReminderWave(input: Parameters<typeof reminders.sendPitchReminderWave>[0]) {
  return pitchesOperation("admin_reminder_send", () => reminders.sendPitchReminderWave(input), {
    access: "write",
    timeoutMs: false,
  });
}

function runAutomaticReminders(input: Parameters<typeof reminders.runAutomaticPitchReminders>[0]) {
  return pitchesOperation(
    "automatic_reminder_send",
    () => reminders.runAutomaticPitchReminders(input),
    { access: "maintenance", timeoutMs: false },
  );
}

function createPresentation(eventTitle?: string) {
  return pitchesOperation(
    "presentation_create",
    () => presentation.createPresentationRoom(eventTitle),
    { access: "live" },
  );
}

function joinPresentation(roomId: string, name: string) {
  return pitchesOperation("presentation_join", () => presentation.joinPresentation(roomId, name), {
    access: "live",
  });
}

function readPresentation(...input: Parameters<typeof presentation.readPresentation>) {
  return pitchesOperation("presentation_read", () => presentation.readPresentation(...input), {
    access: "live",
  });
}

function approveController(
  input: Parameters<typeof presentation.approvePresentationController>[0],
) {
  return pitchesOperation(
    "presentation_approve",
    () => presentation.approvePresentationController(input),
    { access: "live" },
  );
}

function controlPresentation(input: Parameters<typeof presentation.controlPresentation>[0]) {
  return pitchesOperation("presentation_control", () => presentation.controlPresentation(input), {
    access: "live",
  });
}
