import QRCode from "qrcode";
import jsQR from "jsqr";
import sharp from "sharp";

import { getEvent } from "@/features/events/store.server";
import {
  discoveryClueCredential,
  discoveryCredential,
  listDiscoveries,
  listDiscoveryClues,
} from "./discoveries.server";
import { printLayout, type PrintLayout, type PrintPack, validatePrintPack } from "./print";

export async function buildDiscoveryPrintPack(input: {
  eventSlug: string;
  layout: PrintLayout;
  paper?: PrintPack["paper"];
  includePoints?: boolean;
  includePlacementNotes?: boolean;
  discoveryIds?: string[];
}): Promise<
  | { ok: true; pack: PrintPack; qrDataUrls: Record<string, string> }
  | { ok: false; status: number; error: string }
> {
  if (!printLayout(input.layout)) return { ok: false, status: 400, error: "Unknown print layout" };
  const event = await getEvent(input.eventSlug);
  if (!event) return { ok: false, status: 404, error: "Event not found" };
  const discoveries = (await listDiscoveries(input.eventSlug)).filter(
    (discovery) => !input.discoveryIds || input.discoveryIds.includes(discovery.id),
  );
  if (discoveries.length === 0)
    return { ok: false, status: 400, error: "Choose at least one discovery" };
  const printItems = (
    await Promise.all(
      discoveries.map(async (discovery) => {
        if (discovery.method === "collected-clues") {
          return (await listDiscoveryClues(discovery.id)).map((clue) => ({
            id: `${discovery.id}:${clue.key}`,
            title: `${discovery.name} — ${clue.label}`,
            credential: discoveryClueCredential({
              discoveryId: discovery.id,
              clueKey: clue.key,
              revision: clue.replacementRevision,
            }),
            revision: clue.replacementRevision,
            discoveryId: discovery.id,
          }));
        }
        return [
          {
            id: discovery.id,
            title: discovery.name,
            credential: discoveryCredential({
              discoveryId: discovery.id,
              method: discovery.method,
              revision: discovery.replacementRevision,
            }),
            revision: discovery.replacementRevision,
            discoveryId: discovery.id,
          },
        ];
      }),
    )
  ).flat();
  const pack: PrintPack = {
    eventSlug: input.eventSlug,
    title: event.title,
    subtitle: event.startsAt
      ? new Date(event.startsAt).toLocaleDateString("en-GB", { dateStyle: "long" })
      : undefined,
    paper: input.paper ?? "a4",
    layout: input.layout,
    includePoints: input.includePoints ?? true,
    includePlacementNotes: input.includePlacementNotes ?? false,
    items: printItems.map((item) => {
      return {
        id: item.id,
        title: item.title,
        destination: `/events/${encodeURIComponent(input.eventSlug)}/discoveries/${encodeURIComponent(item.discoveryId)}#clue=${encodeURIComponent(item.credential)}`,
        fallbackCode: item.credential,
        revision: item.revision,
        private: false,
      };
    }),
  };
  const errors = validatePrintPack(pack);
  if (errors.length > 0) return { ok: false, status: 422, error: errors.join("; ") };
  const qrDataUrls: Record<string, string> = {};
  for (const item of pack.items) {
    const dataUrl = await QRCode.toDataURL(item.destination, {
      margin: 4,
      width: 512,
    });
    const encoded = dataUrl.split(",", 2)[1];
    if (!encoded) return { ok: false, status: 500, error: `QR generation failed for ${item.id}` };
    const decoded = await sharp(Buffer.from(encoded, "base64"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(decoded.data), decoded.info.width, decoded.info.height);
    if (!code || code.data !== item.destination) {
      return { ok: false, status: 422, error: `QR validation failed for ${item.id}` };
    }
    qrDataUrls[item.id] = dataUrl;
  }
  return { ok: true, pack, qrDataUrls };
}
