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
    {
      path: string;
      private: boolean;
      items: Array<{ title: string; subtitle: string }>;
    }
  > = {
    setup: {
      path: `/events/${input.eventSlug}`,
      private: true,
      items: [
        {
          title: "Confirm event state",
          subtitle: "Keep scoring ready until the final live preview is approved.",
        },
        {
          title: "Check staff access",
          subtitle: "Open each assigned device and revoke any link that is no longer needed.",
        },
        {
          title: "Count point pools",
          subtitle: "Confirm issued, reserved, held, spent, and available points.",
        },
        {
          title: "Place and scan signs",
          subtitle: "Test each printed QR and its fallback code from the expected distance.",
        },
        {
          title: "Rehearse safe failures",
          subtitle: "Test duplicate, paused, exhausted, expired, and unidentified outcomes.",
        },
        {
          title: "Confirm closeout owner",
          subtitle: "Name who will resolve held work, export results, and finalize prizes.",
        },
      ],
    },
    instructions: {
      path: `/events/${input.eventSlug}/discoveries`,
      private: false,
      items: [
        {
          title: "How to take part",
          subtitle: "Open your ticket before you scan a clue or enter a fallback code.",
        },
        {
          title: "One claim per person",
          subtitle: "A copied code does not prove that somebody visited a location.",
        },
        {
          title: "Wait for confirmation",
          subtitle: "Only a confirmed result changes your score and rank.",
        },
        {
          title: "Need help?",
          subtitle: "Show staff your ticket. Do not share its private link or QR.",
        },
      ],
    },
    placement: {
      path: `/events/${input.eventSlug}`,
      private: true,
      items: [
        {
          title: "Placement list",
          subtitle:
            "Record each clue ID, visible revision, exact location, owner, and recovery plan.",
        },
        {
          title: "Replacement log",
          subtitle:
            "When paper is replaced, confirm that only the old clue revision stops working.",
        },
      ],
    },
    control: {
      path: `/events/${input.eventSlug}`,
      private: true,
      items: [
        {
          title: "Answer and control sheet",
          subtitle:
            "Keep answers, fallback codes, clue states, and pool limits with the event manager.",
        },
        {
          title: "Incident notes",
          subtitle: "Record pauses, replacements, held claims, corrections, and the staff actor.",
        },
      ],
    },
    moderator: {
      path: `/events/${input.eventSlug}`,
      private: true,
      items: [
        {
          title: "Choose one operation",
          subtitle: "Admit, run an activity, and award points are separate actions.",
        },
        {
          title: "Review before award",
          subtitle: "Confirm the participant, activity, outcome, points, and pool before saving.",
        },
        {
          title: "Undo a recent mistake",
          subtitle: "Use the immutable reversal. Never edit score history.",
        },
        {
          title: "Escalate uncertain work",
          subtitle: "Hold conflicts for a manager. Do not guess identity or accuse a guest.",
        },
      ],
    },
    leaderboard: {
      path: `/events/${input.eventSlug}/score`,
      private: false,
      items: [
        {
          title: "Live event leaderboard",
          subtitle: "Scan to see confirmed scores. Tied scores share a rank.",
        },
      ],
    },
    "ticket-score": {
      path: `/events/${input.eventSlug}`,
      private: false,
      items: [
        {
          title: "Your ticket and score",
          subtitle: "Open your private ticket link to see points, rank, history, and clues.",
        },
        {
          title: "Keep the ticket private",
          subtitle: "Anybody with the bearer link can open this attendee place.",
        },
      ],
    },
    "photo-upload": {
      path: `/events/${input.eventSlug}`,
      private: false,
      items: [
        {
          title: "Share event photographs",
          subtitle: "Ask before capture. Uploads follow the event consent and expiry policy.",
        },
        {
          title: "Score and photo are separate",
          subtitle: "A failed photo upload does not remove or repeat a valid points award.",
        },
      ],
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
    items: definition.items.map((item, index) => ({
      id: `${input.kind}-${index + 1}`,
      title: item.title,
      subtitle: item.subtitle,
      destination,
      fallbackCode: definition.path,
      revision: 1,
      private: definition.private,
    })),
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
  return {
    ok: true as const,
    pack,
    qrDataUrls: Object.fromEntries(pack.items.map((item) => [item.id, dataUrl])),
  };
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

    const commands: string[] = [
      "0 G 0 g 0.7 w",
      `BT /FM 8 Tf ${margin} ${pageHeight - 16} Td (MILK & HENNY) Tj ET`,
    ];
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
      if (item.subtitle) {
        const text = item.subtitle.length > 88 ? `${item.subtitle.slice(0, 85)}...` : item.subtitle;
        commands.push(
          `BT /FR ${Math.min(8, Math.max(6, cellWidth * 0.026))} Tf ${x + inset} ${y + cellHeight * 0.18} Td (${pdfText(text)}) Tj ET`,
        );
      }
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
