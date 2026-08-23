import { Context, Layer } from "effect";

import * as assets from "./assets.server";
import * as engine from "./pitches.server";
import * as presentation from "./presentation.server";
import * as store from "./store.server";
import { pitchesOperation } from "./pitches-operation.server";

export class PitchesService extends Context.Service<
  PitchesService,
  {
    readonly create: typeof create;
    readonly readOwned: typeof readOwned;
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
    createPresentation,
    joinPresentation,
    readPresentation,
    approveController,
    controlPresentation,
  });
}

function create(input: Parameters<typeof engine.createPitch>[0]) {
  return pitchesOperation("create", () => engine.createPitch(input), false);
}

function readOwned(...input: Parameters<typeof engine.readOwnedPitch>) {
  return pitchesOperation("read_owned", () => engine.readOwnedPitch(...input));
}

function listHistory(...input: Parameters<typeof engine.listPitchHistory>) {
  return pitchesOperation("list_history", () => engine.listPitchHistory(...input));
}

function readVersion(...input: Parameters<typeof engine.readPitchVersion>) {
  return pitchesOperation("read_version", () => engine.readPitchVersion(...input));
}

function restoreVersion(...input: Parameters<typeof engine.restorePitchVersion>) {
  return pitchesOperation("restore_version", () => engine.restorePitchVersion(...input));
}

function sync(input: Parameters<typeof engine.syncPitch>[0]) {
  return pitchesOperation("sync", () => engine.syncPitch(input));
}

function publish(input: Parameters<typeof engine.publishPitch>[0]) {
  return pitchesOperation("publish", () => engine.publishPitch(input), false);
}

function listPublished(search?: string) {
  return pitchesOperation("list_published", () => engine.listPublishedPitches(search));
}

function readPublished(deckId: string) {
  return pitchesOperation("read_published", () => engine.readPublishedPitch(deckId));
}

function recover(input: Parameters<typeof engine.recoverPitchAccess>[0]) {
  return pitchesOperation("recover_access", () => engine.recoverPitchAccess(input), false);
}

function allowRecovery(ip: string, email: string) {
  return pitchesOperation("allow_recovery", () => engine.allowPitchRecovery(ip, email));
}

function createAssetUpload(input: Parameters<typeof engine.createPitchAssetUpload>[0]) {
  return pitchesOperation("create_asset_upload", () => engine.createPitchAssetUpload(input));
}

function finaliseAsset(input: Parameters<typeof engine.finalisePitchAsset>[0]) {
  return pitchesOperation("finalise_asset", () => engine.finalisePitchAsset(input));
}

function cleanup(limit?: number) {
  return pitchesOperation("cleanup", () => engine.cleanupExpiredPitches(limit), false);
}

function listAdmin() {
  return pitchesOperation("admin_list", () => store.listPitchDecksForAdmin());
}

function readAdmin(deckId: string) {
  return pitchesOperation("admin_read", () => store.readPitchDeckForAdmin(deckId));
}

function adminDetail(deckId: string) {
  return pitchesOperation("admin_detail", () => engine.readPitchForAdmin(deckId));
}

function archive(deckId: string, archived: boolean) {
  return pitchesOperation("admin_archive", () => store.setPitchDeckArchived(deckId, archived));
}

function adminAssets(deckId: string) {
  return pitchesOperation("admin_assets", () => assets.signedPitchAssets(deckId));
}

function updateAdmin(input: Parameters<typeof engine.updatePitchForAdmin>[0]) {
  return pitchesOperation("admin_update", () => engine.updatePitchForAdmin(input));
}

function restoreAdmin(...input: Parameters<typeof engine.restorePitchForAdmin>) {
  return pitchesOperation("admin_restore_backup", () => engine.restorePitchForAdmin(...input));
}

function resendAdmin(input: Parameters<typeof engine.resendPitchAccessForAdmin>[0]) {
  return pitchesOperation("admin_resend", () => engine.resendPitchAccessForAdmin(input), false);
}

function deleteAdmin(...input: Parameters<typeof engine.deletePitchForAdmin>) {
  return pitchesOperation("admin_delete", () => engine.deletePitchForAdmin(...input), false);
}

function createPresentation(eventTitle?: string) {
  return pitchesOperation("presentation_create", () =>
    presentation.createPresentationRoom(eventTitle),
  );
}

function joinPresentation(roomId: string, name: string) {
  return pitchesOperation("presentation_join", () => presentation.joinPresentation(roomId, name));
}

function readPresentation(...input: Parameters<typeof presentation.readPresentation>) {
  return pitchesOperation("presentation_read", () => presentation.readPresentation(...input));
}

function approveController(
  input: Parameters<typeof presentation.approvePresentationController>[0],
) {
  return pitchesOperation("presentation_approve", () =>
    presentation.approvePresentationController(input),
  );
}

function controlPresentation(input: Parameters<typeof presentation.controlPresentation>[0]) {
  return pitchesOperation("presentation_control", () => presentation.controlPresentation(input));
}
