import QRCode from "qrcode";
import jsQR from "jsqr";
import sharp from "sharp";

import { getEvent } from "@/features/events/store.server";
import { discoveryCredential, listDiscoveries } from "./discoveries.server";
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
    items: discoveries.map((discovery) => {
      const credential = discoveryCredential({
        discoveryId: discovery.id,
        method: discovery.method,
        revision: discovery.replacementRevision,
      });
      return {
        id: discovery.id,
        title: discovery.name,
        destination: `/events/${encodeURIComponent(input.eventSlug)}/discoveries/${encodeURIComponent(discovery.id)}#clue=${encodeURIComponent(credential)}`,
        fallbackCode: credential,
        revision: discovery.replacementRevision,
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
