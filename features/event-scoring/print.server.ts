import QRCode from "qrcode";
import jsQR from "jsqr";
import sharp from "sharp";
import { deflateSync, inflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

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
  return asciiPdfText(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function asciiPdfText(value: string): string {
  return value.normalize("NFKD").replace(/[^\x20-\x7e]/g, "-");
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

export function inspectRenderedPrintPdf(pdf: Buffer): {
  pageSizes: Array<[number, number]>;
  qrDestinations: string[];
  embeddedFontCount: number;
} {
  const latin = pdf.toString("latin1");
  const pageSizes = [
    ...latin.matchAll(/\/Type \/Page(?!s)[\s\S]*?\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g),
  ].map((match) => [Number(match[1]), Number(match[2])] as [number, number]);
  const qrDestinations: string[] = [];
  let cursor = 0;
  while ((cursor = latin.indexOf("/Subtype /Image", cursor)) >= 0) {
    const streamMarker = latin.indexOf("stream\n", cursor);
    if (streamMarker < 0) throw new Error("Embedded PDF image stream is incomplete");
    const dictionary = latin.slice(cursor, streamMarker);
    const width = Number(/\/Width (\d+)/.exec(dictionary)?.[1]);
    const height = Number(/\/Height (\d+)/.exec(dictionary)?.[1]);
    const length = Number(/\/Length (\d+)/.exec(dictionary)?.[1]);
    if (!width || !height || !length) throw new Error("Embedded PDF image metadata is invalid");
    const start = Buffer.byteLength(latin.slice(0, streamMarker + 7), "latin1");
    const rgb = inflateSync(pdf.subarray(start, start + length));
    if (rgb.length !== width * height * 3) throw new Error("Embedded PDF QR has invalid pixels");
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let source = 0, target = 0; source < rgb.length; source += 3, target += 4) {
      rgba[target] = rgb[source]!;
      rgba[target + 1] = rgb[source + 1]!;
      rgba[target + 2] = rgb[source + 2]!;
      rgba[target + 3] = 255;
    }
    const decoded = jsQR(rgba, width, height);
    if (!decoded) throw new Error("An embedded PDF QR could not be decoded");
    qrDestinations.push(decoded.data);
    cursor = streamMarker + 7 + length;
  }
  return {
    pageSizes,
    qrDestinations,
    embeddedFontCount: [...latin.matchAll(/\/FontFile2\s+\d+\s+0\s+R/g)].length,
  };
}

const require = createRequire(import.meta.url);

async function loadPrintFonts() {
  const resolve = (name: string) =>
    require.resolve(`pdfjs-dist/standard_fonts/LiberationSans-${name}.ttf`);
  return Promise.all([readFile(resolve("Regular")), readFile(resolve("Bold"))]);
}

function trueTypeTable(bytes: Buffer, name: string): number {
  const count = bytes.readUInt16BE(4);
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    if (bytes.toString("ascii", record, record + 4) === name) return bytes.readUInt32BE(record + 8);
  }
  throw new Error(`Embedded font has no ${name} table`);
}

function trueTypeGlyph(bytes: Buffer, code: number): number {
  const cmap = trueTypeTable(bytes, "cmap");
  const count = bytes.readUInt16BE(cmap + 2);
  let format4 = 0;
  for (let index = 0; index < count; index += 1) {
    const record = cmap + 4 + index * 8;
    const platform = bytes.readUInt16BE(record);
    const encoding = bytes.readUInt16BE(record + 2);
    const candidate = cmap + bytes.readUInt32BE(record + 4);
    if (
      bytes.readUInt16BE(candidate) === 4 &&
      platform === 3 &&
      (encoding === 1 || encoding === 10)
    ) {
      format4 = candidate;
      break;
    }
  }
  if (!format4) throw new Error("Embedded font has no Windows Unicode cmap");
  const segmentCount = bytes.readUInt16BE(format4 + 6) / 2;
  const endCodes = format4 + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const deltas = startCodes + segmentCount * 2;
  const rangeOffsets = deltas + segmentCount * 2;
  for (let index = 0; index < segmentCount; index += 1) {
    const end = bytes.readUInt16BE(endCodes + index * 2);
    const start = bytes.readUInt16BE(startCodes + index * 2);
    if (code < start || code > end) continue;
    const delta = bytes.readInt16BE(deltas + index * 2);
    const rangeOffsetAddress = rangeOffsets + index * 2;
    const rangeOffset = bytes.readUInt16BE(rangeOffsetAddress);
    if (rangeOffset === 0) return (code + delta) & 0xffff;
    const glyphAddress = rangeOffsetAddress + rangeOffset + (code - start) * 2;
    const glyph = bytes.readUInt16BE(glyphAddress);
    return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
  }
  return 0;
}

function trueTypeAsciiWidths(bytes: Buffer): number[] {
  const unitsPerEm = bytes.readUInt16BE(trueTypeTable(bytes, "head") + 18);
  const metricCount = bytes.readUInt16BE(trueTypeTable(bytes, "hhea") + 34);
  const metrics = trueTypeTable(bytes, "hmtx");
  return Array.from({ length: 95 }, (_, index) => {
    const glyph = trueTypeGlyph(bytes, index + 32);
    const metric = Math.min(glyph, metricCount - 1);
    return Math.round((bytes.readUInt16BE(metrics + metric * 4) * 1000) / unitsPerEm);
  });
}

type EmbeddedFont = { id: number; widths: number[] };

function embeddedTrueTypeFont(input: {
  add: (object: PdfObject) => number;
  bytes: Buffer;
  name: string;
  bold: boolean;
}): EmbeddedFont {
  const fileId = input.add(
    streamObject(`/Filter /FlateDecode /Length1 ${input.bytes.length}`, deflateSync(input.bytes)),
  );
  const descriptorId = input.add(
    `<< /Type /FontDescriptor /FontName /${input.name} /Flags 32 /FontBBox [-543 -303 1301 981] /ItalicAngle 0 /Ascent 905 /Descent -212 /CapHeight 728 /StemV ${input.bold ? 120 : 80} /FontFile2 ${fileId} 0 R >>`,
  );
  const widths = trueTypeAsciiWidths(input.bytes);
  const id = input.add(
    `<< /Type /Font /Subtype /TrueType /BaseFont /${input.name} /FirstChar 32 /LastChar 126 /Widths [${widths.join(" ")}] /Encoding /WinAnsiEncoding /FontDescriptor ${descriptorId} 0 R >>`,
  );
  return { id, widths };
}

function textWidth(value: string, size: number, widths: number[]): number {
  return (
    [...asciiPdfText(value)].reduce(
      (total, character) => total + (widths[character.charCodeAt(0) - 32] ?? 600),
      0,
    ) *
    (size / 1000)
  );
}

function fitText(value: string, size: number, maxWidth: number, widths: number[]): string {
  const text = asciiPdfText(value);
  if (textWidth(text, size, widths) <= maxWidth) return text;
  let fitted = text;
  while (fitted.length > 1 && textWidth(`${fitted}...`, size, widths) > maxWidth)
    fitted = fitted.slice(0, -1);
  return `${fitted.trimEnd()}...`;
}

function pdfTextCommand(input: {
  font: "FB" | "FR";
  fontMetrics: EmbeddedFont;
  size: number;
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  align?: "left" | "center" | "right";
}): string {
  const text = fitText(input.text, input.size, input.maxWidth, input.fontMetrics.widths);
  const width = textWidth(text, input.size, input.fontMetrics.widths);
  const x =
    input.align === "center"
      ? input.x - width / 2
      : input.align === "right"
        ? input.x - width
        : input.x;
  return `BT /${input.font} ${input.size} Tf ${x} ${input.y} Td (${pdfText(text)}) Tj ET`;
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
  const [regularFontBytes, boldFontBytes] = await loadPrintFonts();
  const regularFont = embeddedTrueTypeFont({
    add,
    bytes: regularFontBytes,
    name: "MAHLiberationSans",
    bold: false,
  });
  const boldFont = embeddedTrueTypeFont({
    add,
    bytes: boldFontBytes,
    name: "MAHLiberationSans-Bold",
    bold: true,
  });
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
      pdfTextCommand({
        font: "FB",
        fontMetrics: boldFont,
        size: 8,
        text: "MILK & HENNY",
        x: margin,
        y: pageHeight - 16,
        maxWidth: pageWidth - margin * 2,
      }),
    ];
    for (const [index, item] of pageItems.entries()) {
      const column = index % layout.columns;
      const row = Math.floor(index / layout.columns);
      const x = margin + column * (cellWidth + gap);
      const y = pageHeight - margin - (row + 1) * cellHeight - row * gap;
      const inset = Math.min(18, cellWidth * 0.08);
      const compact = cellHeight < 250;
      const headerHeight = compact ? (item.subtitle ? 42 : 28) : item.subtitle ? 62 : 42;
      const footerHeight = compact ? 50 : 92;
      const qrSize = Math.min(
        cellWidth * (compact ? 0.42 : 0.58),
        cellHeight - headerHeight - footerHeight,
      );
      const qrX = x + (cellWidth - qrSize) / 2;
      const qrY =
        y + footerHeight + Math.max(0, (cellHeight - headerHeight - footerHeight - qrSize) / 2);
      const titleSize = Math.min(compact ? 13 : 18, Math.max(compact ? 9 : 10, cellWidth * 0.055));
      if (input.pack.includeCutGuides !== false)
        commands.push(`${x} ${y} ${cellWidth} ${cellHeight} re S`);
      commands.push(
        pdfTextCommand({
          font: "FB",
          fontMetrics: boldFont,
          size: titleSize,
          text: item.title,
          x: x + inset,
          y: y + cellHeight - inset - titleSize,
          maxWidth: cellWidth - inset * 2,
        }),
        `q ${qrSize} 0 0 ${qrSize} ${qrX} ${qrY} cm /Q${index} Do Q`,
        pdfTextCommand({
          font: "FR",
          fontMetrics: regularFont,
          size: compact ? 6.5 : 9,
          text: "Scan to open the clue",
          x: x + cellWidth / 2,
          y: y + (compact ? 29 : 62),
          maxWidth: cellWidth - inset * 2,
          align: "center",
        }),
        pdfTextCommand({
          font: "FB",
          fontMetrics: boldFont,
          size: compact ? 8 : 10,
          text: item.fallbackCode,
          x: x + cellWidth / 2,
          y: y + (compact ? 17 : 43),
          maxWidth: cellWidth - inset * 2,
          align: "center",
        }),
      );
      if (item.subtitle) {
        commands.push(
          pdfTextCommand({
            font: "FR",
            fontMetrics: regularFont,
            size: compact ? 6 : Math.min(8, Math.max(6, cellWidth * 0.026)),
            text: item.subtitle,
            x: x + inset,
            y: y + cellHeight - inset - titleSize - (compact ? 11 : 16),
            maxWidth: cellWidth - inset * 2,
          }),
        );
      }
      if (input.pack.includePoints && item.points !== undefined) {
        commands.push(
          pdfTextCommand({
            font: "FB",
            fontMetrics: boldFont,
            size: compact ? 6.5 : 8,
            text: `${item.points} points`,
            x: x + inset,
            y: y + (compact ? 6 : 13),
            maxWidth: cellWidth * 0.35,
          }),
        );
      }
      if (input.pack.includePlacementNotes && item.placementNote) {
        commands.push(
          pdfTextCommand({
            font: "FR",
            fontMetrics: regularFont,
            size: compact ? 5.5 : 7,
            text: item.placementNote,
            x: x + cellWidth / 2,
            y: y + (compact ? 40 : 27),
            maxWidth: cellWidth - inset * 2,
            align: "center",
          }),
        );
      }
      commands.push(
        pdfTextCommand({
          font: "FR",
          fontMetrics: regularFont,
          size: compact ? 5.5 : 7,
          text: `Revision ${item.revision}`,
          x: x + cellWidth - inset,
          y: y + (compact ? 6 : 13),
          maxWidth: cellWidth * 0.35,
          align: "right",
        }),
      );
    }
    const pageNumber = Math.floor(offset / pageCapacity) + 1;
    commands.push(
      pdfTextCommand({
        font: "FR",
        fontMetrics: regularFont,
        size: 7,
        text: input.pack.title,
        x: margin,
        y: 12,
        maxWidth: pageWidth * 0.7,
      }),
    );
    if (input.pack.includePageNumbers !== false)
      commands.push(
        pdfTextCommand({
          font: "FR",
          fontMetrics: regularFont,
          size: 7,
          text: `Page ${pageNumber}`,
          x: pageWidth - margin,
          y: 12,
          maxWidth: 60,
          align: "right",
        }),
      );
    const contentId = add(streamObject("", commands.join("\n")));
    const xObjects = imageIds.map((id, index) => `/Q${index} ${id} 0 R`).join(" ");
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /FR ${regularFont.id} 0 R /FB ${boldFont.id} 0 R >> /XObject << ${xObjects} >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  const pdf = compilePdf(objects, catalogId);
  const inspected = inspectRenderedPrintPdf(pdf);
  const expected = input.pack.items.map((item) => item.destination);
  if (
    inspected.qrDestinations.length !== expected.length ||
    inspected.qrDestinations.some((destination, index) => destination !== expected[index])
  ) {
    throw new Error("Finished PDF QR validation failed");
  }
  return pdf;
}
