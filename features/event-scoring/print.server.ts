import QRCode from "qrcode";
import jsQR from "jsqr";
import sharp from "sharp";
import { deflateSync } from "node:zlib";

import { getEvent } from "@/features/events/store.server";
import { BASE_URL } from "@/lib/shared/config";
import {
  discoveryClueCredential,
  discoveryCredential,
  listDiscoveries,
  listDiscoveryClues,
} from "./discoveries.server";
import {
  PRINT_LAYOUTS,
  printLayout,
  type PrintLayout,
  type PrintPack,
  type PrintPackKind,
  validatePrintPack,
} from "./print";

export async function buildDiscoveryPrintPack(input: {
  eventSlug: string;
  layout: PrintLayout;
  paper?: PrintPack["paper"];
  includePoints?: boolean;
  includePlacementNotes?: boolean;
  includeCutGuides?: boolean;
  includePageNumbers?: boolean;
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
    kind: "hunt",
    title: event.title,
    subtitle: event.startsAt
      ? new Date(event.startsAt).toLocaleDateString("en-GB", { dateStyle: "long" })
      : undefined,
    paper: input.paper ?? "a4",
    layout: input.layout,
    includePoints: input.includePoints ?? true,
    includePlacementNotes: input.includePlacementNotes ?? false,
    includeCutGuides: input.includeCutGuides ?? true,
    includePageNumbers: input.includePageNumbers ?? true,
    items: printItems.map((item) => {
      return {
        id: item.id,
        title: item.title,
        destination: `${BASE_URL}/events/${encodeURIComponent(input.eventSlug)}/discoveries/${encodeURIComponent(item.discoveryId)}#clue=${encodeURIComponent(item.credential)}`,
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

export async function buildEventPrintPack(input: {
  eventSlug: string;
  kind: PrintPackKind;
  layout: PrintLayout;
  paper?: PrintPack["paper"];
  includePoints?: boolean;
  includePlacementNotes?: boolean;
  includeCutGuides?: boolean;
  includePageNumbers?: boolean;
  discoveryIds?: string[];
}) {
  if (input.kind === "hunt") return buildDiscoveryPrintPack(input);
  const event = await getEvent(input.eventSlug);
  if (!event) return { ok: false as const, status: 404, error: "Event not found" };
  const definitions: Record<
    Exclude<PrintPackKind, "hunt">,
    { title: string; subtitle: string; path: string; private: boolean }
  > = {
    setup: {
      title: "Event setup checklist",
      subtitle: "Place signs, test every QR, and confirm scoring state.",
      path: `/events/${input.eventSlug}`,
      private: true,
    },
    instructions: {
      title: "How to take part",
      subtitle: "Open your ticket, scan a clue, and confirm each claim.",
      path: `/events/${input.eventSlug}/discoveries`,
      private: false,
    },
    placement: {
      title: "Private placement list",
      subtitle: "Record each clue location and revision before doors open.",
      path: `/events/${input.eventSlug}`,
      private: true,
    },
    control: {
      title: "Private answer and control sheet",
      subtitle: "Keep this sheet with the event manager.",
      path: `/events/${input.eventSlug}`,
      private: true,
    },
    moderator: {
      title: "Moderator instructions",
      subtitle: "Choose an operation before scanning. Review every award before saving.",
      path: `/events/${input.eventSlug}`,
      private: true,
    },
    leaderboard: {
      title: "Live event leaderboard",
      subtitle: "Scan to see confirmed event scores.",
      path: `/events/${input.eventSlug}/score`,
      private: false,
    },
    "ticket-score": {
      title: "Your ticket and score",
      subtitle: "Open your ticket link to see points, rank, and clues.",
      path: `/events/${input.eventSlug}`,
      private: false,
    },
    "photo-upload": {
      title: "Share event photographs",
      subtitle: "Uploads follow the event consent policy and expire with the album.",
      path: `/events/${input.eventSlug}`,
      private: false,
    },
  };
  const definition = definitions[input.kind];
  const destination = `${BASE_URL}${definition.path}`;
  const pack: PrintPack = {
    kind: input.kind,
    eventSlug: input.eventSlug,
    title: event.title,
    subtitle: event.startsAt
      ? new Date(event.startsAt).toLocaleDateString("en-GB", { dateStyle: "long" })
      : undefined,
    paper: input.paper ?? "a4",
    layout: input.layout,
    includePoints: false,
    includePlacementNotes: false,
    includeCutGuides: input.includeCutGuides ?? true,
    includePageNumbers: input.includePageNumbers ?? true,
    items: [
      {
        id: input.kind,
        title: definition.title,
        subtitle: definition.subtitle,
        destination,
        fallbackCode: definition.path,
        revision: 1,
        private: definition.private,
      },
    ],
  };
  const errors = validatePrintPack(pack);
  if (errors.length > 0) return { ok: false as const, status: 422, error: errors.join("; ") };
  const dataUrl = await QRCode.toDataURL(destination, { margin: 4, width: 512 });
  const encoded = dataUrl.split(",", 2)[1];
  if (!encoded) return { ok: false as const, status: 500, error: "QR generation failed" };
  const decoded = await sharp(Buffer.from(encoded, "base64"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const code = jsQR(new Uint8ClampedArray(decoded.data), decoded.info.width, decoded.info.height);
  if (!code || code.data !== destination)
    return { ok: false as const, status: 422, error: "QR validation failed" };
  return { ok: true as const, pack, qrDataUrls: { [input.kind]: dataUrl } };
}

type PdfObject = string | Buffer;

const PAPER_POINTS: Record<PrintPack["paper"], [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  a5: [419.53, 595.28],
  card: [288, 432],
};

function pdfText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "-")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function streamObject(dictionary: string, data: Buffer | string): Buffer {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, "latin1");
  return Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`, "latin1"),
    bytes,
    Buffer.from("\nendstream", "latin1"),
  ]);
}

function compilePdf(objects: PdfObject[], rootId: number): Buffer {
  const chunks: Buffer[] = [Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];
  let length = chunks[0]!.length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const body = Buffer.isBuffer(object) ? object : Buffer.from(object, "latin1");
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "latin1"),
      body,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    chunks.push(chunk);
    length += chunk.length;
  }
  const xref = length;
  const lines = [`xref`, `0 ${objects.length + 1}`, "0000000000 65535 f "];
  for (const offset of offsets.slice(1)) lines.push(`${String(offset).padStart(10, "0")} 00000 n `);
  lines.push(
    `trailer`,
    `<< /Size ${objects.length + 1} /Root ${rootId} 0 R >>`,
    `startxref`,
    String(xref),
    "%%EOF",
  );
  chunks.push(Buffer.from(`${lines.join("\n")}\n`, "latin1"));
  return Buffer.concat(chunks);
}

/** Render a self-contained PDF in the Node runtime. QR source images are validated first. */
export async function renderDiscoveryPrintPdf(input: {
  pack: PrintPack;
  qrDataUrls: Record<string, string>;
}): Promise<Buffer> {
  const errors = validatePrintPack(input.pack);
  if (errors.length > 0) throw new Error(errors.join("; "));
  const [pageWidth, pageHeight] = PAPER_POINTS[input.pack.paper];
  const layout = PRINT_LAYOUTS[input.pack.layout];
  const pageCapacity = layout.columns * layout.rows;
  const margin = 28;
  const gap = 12;
  const cellWidth = (pageWidth - margin * 2 - gap * (layout.columns - 1)) / layout.columns;
  const cellHeight = (pageHeight - margin * 2 - gap * (layout.rows - 1)) / layout.rows;
  const objects: PdfObject[] = [];
  const add = (object: PdfObject) => (objects.push(object), objects.length);
  const catalogId = add("");
  const pagesId = add("");
  const regularFontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldFontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const monoFontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>");
  const pageIds: number[] = [];

  for (let offset = 0; offset < input.pack.items.length; offset += pageCapacity) {
    const pageItems = input.pack.items.slice(offset, offset + pageCapacity);
    const imageIds: number[] = [];
    for (const item of pageItems) {
      const dataUrl = input.qrDataUrls[item.id];
      const encoded = dataUrl?.split(",", 2)[1];
      if (!encoded) throw new Error(`Missing validated QR for ${item.id}`);
      const raw = await sharp(Buffer.from(encoded, "base64"))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      imageIds.push(
        add(
          streamObject(
            `/Type /XObject /Subtype /Image /Width ${raw.info.width} /Height ${raw.info.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`,
            deflateSync(raw.data),
          ),
        ),
      );
    }

    const commands: string[] = ["0 G 0 g 0.7 w"];
    for (const [index, item] of pageItems.entries()) {
      const column = index % layout.columns;
      const row = Math.floor(index / layout.columns);
      const x = margin + column * (cellWidth + gap);
      const y = pageHeight - margin - (row + 1) * cellHeight - row * gap;
      const inset = Math.min(18, cellWidth * 0.08);
      const qrSize = Math.min(cellWidth * 0.58, cellHeight * 0.6);
      const qrX = x + (cellWidth - qrSize) / 2;
      const qrY = y + cellHeight * 0.21;
      if (input.pack.includeCutGuides !== false)
        commands.push(`${x} ${y} ${cellWidth} ${cellHeight} re S`);
      commands.push(
        `BT /FB ${Math.min(18, Math.max(10, cellWidth * 0.055))} Tf ${x + inset} ${y + cellHeight - inset - 16} Td (${pdfText(item.title)}) Tj ET`,
        `q ${qrSize} 0 0 ${qrSize} ${qrX} ${qrY} cm /Q${index} Do Q`,
        `BT /FR ${Math.min(10, Math.max(7, cellWidth * 0.032))} Tf ${x + cellWidth / 2} ${y + cellHeight * 0.15} Td (${pdfText("Scan to open the clue")}) Tj ET`,
        `BT /FM ${Math.min(11, Math.max(8, cellWidth * 0.035))} Tf ${x + cellWidth / 2} ${y + cellHeight * 0.09} Td (${pdfText(item.fallbackCode)}) Tj ET`,
        `BT /FR ${Math.min(7, Math.max(5, cellWidth * 0.022))} Tf ${x + cellWidth / 2} ${y + cellHeight * 0.035} Td (${pdfText(`Revision ${item.revision}`)}) Tj ET`,
      );
      if (input.pack.includePoints && item.points !== undefined) {
        commands.push(`BT /FB 9 Tf ${x + inset} ${y + inset} Td (${item.points} points) Tj ET`);
      }
      if (input.pack.includePlacementNotes && item.placementNote) {
        commands.push(
          `BT /FR 7 Tf ${x + inset} ${y + inset + 12} Td (${pdfText(item.placementNote)}) Tj ET`,
        );
      }
    }
    const pageNumber = Math.floor(offset / pageCapacity) + 1;
    commands.push(`BT /FR 7 Tf ${margin} 12 Td (${pdfText(input.pack.title)}) Tj ET`);
    if (input.pack.includePageNumbers !== false)
      commands.push(`BT /FR 7 Tf ${pageWidth - margin - 38} 12 Td (Page ${pageNumber}) Tj ET`);
    const contentId = add(streamObject("", commands.join("\n")));
    const xObjects = imageIds.map((id, index) => `/Q${index} ${id} 0 R`).join(" ");
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /FR ${regularFontId} 0 R /FB ${boldFontId} 0 R /FM ${monoFontId} 0 R >> /XObject << ${xObjects} >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  return compilePdf(objects, catalogId);
}
