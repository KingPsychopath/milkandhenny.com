#!/usr/bin/env python3
"""Render a validated event scoring print pack to a stable, monochrome PDF."""

import argparse
import base64
import io
import json
import re
from pathlib import Path

from reportlab.lib.pagesizes import A4, A5, LETTER
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


LAYOUTS = {
    "full-page": (1, 1),
    "two-per-page": (1, 2),
    "four-per-page": (2, 2),
    "six-per-page": (2, 3),
    "eight-clues": (2, 4),
    "twelve-small": (3, 4),
    "a5-sign": (1, 1),
    "table-tent": (1, 2),
    "replacement": (1, 1),
}


def page_size(paper):
    if paper == "letter":
        return LETTER
    if paper == "a5":
        return A5
    return A4


def validate(pack):
    if not pack.get("eventSlug") or not pack.get("title"):
        raise ValueError("eventSlug and title are required")
    layout = pack.get("layout")
    if layout not in LAYOUTS:
        raise ValueError(f"unsupported layout: {layout}")
    seen = set()
    for item in pack.get("items", []):
        item_id = item.get("id")
        destination = item.get("destination", "")
        if not item_id or item_id in seen:
            raise ValueError(f"duplicate or missing item id: {item_id}")
        if not destination.startswith("/") or re.search(r"staff|admin|token|secret", destination, re.I):
            raise ValueError(f"unsafe destination for {item_id}")
        if not item.get("fallbackCode"):
            raise ValueError(f"missing fallback code for {item_id}")
        seen.add(item_id)
    return layout


def qr_image(data_url):
    if not data_url.startswith("data:image/png;base64,"):
        raise ValueError("QR data must be a PNG data URL")
    return ImageReader(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1])))


def draw_item(pdf, item, qr_data_url, x, y, width, height, include_points):
    pdf.setStrokeGray(0.72)
    pdf.rect(x, y, width, height, stroke=1, fill=0)
    inset = min(18, width * 0.08)
    pdf.setFillGray(0.05)
    pdf.setFont("Helvetica-Bold", min(18, max(10, width * 0.055)))
    pdf.drawString(x + inset, y + height - inset - 16, str(item.get("title", "Discovery")))

    qr_size = min(width * 0.58, height * 0.62)
    qr_x = x + (width - qr_size) / 2
    qr_y = y + height * 0.22
    pdf.drawImage(qr_image(qr_data_url), qr_x, qr_y, qr_size, qr_size, preserveAspectRatio=True, mask="auto")

    pdf.setFont("Helvetica", min(10, max(7, width * 0.032)))
    pdf.drawCentredString(x + width / 2, y + height * 0.15, "Scan to open the clue")
    pdf.setFont("Courier-Bold", min(11, max(8, width * 0.035)))
    pdf.drawCentredString(x + width / 2, y + height * 0.09, str(item.get("fallbackCode", "")))
    pdf.setFont("Helvetica", min(7, max(5, width * 0.022)))
    pdf.drawCentredString(x + width / 2, y + height * 0.035, f"Revision {item.get('revision', 1)}")


def render(pack, output):
    layout = validate(pack)
    columns, rows = LAYOUTS[layout]
    paper = page_size(pack.get("paper", "a4"))
    pdf = canvas.Canvas(str(output), pagesize=paper)
    page_width, page_height = paper
    margin = 28
    gap = 12
    cell_width = (page_width - 2 * margin - (columns - 1) * gap) / columns
    cell_height = (page_height - 2 * margin - (rows - 1) * gap) / rows
    items = pack.get("items", [])
    qr_data_urls = pack.get("qrDataUrls", {})

    for offset in range(0, len(items), columns * rows):
        page_items = items[offset : offset + columns * rows]
        for index, item in enumerate(page_items):
            item_id = item.get("id")
            if item_id not in qr_data_urls:
                raise ValueError(f"missing QR data for {item_id}")
            column = index % columns
            row = index // columns
            x = margin + column * (cell_width + gap)
            y = page_height - margin - (row + 1) * cell_height - row * gap
            draw_item(pdf, item, qr_data_urls[item_id], x, y, cell_width, cell_height, pack.get("includePoints", True))
        pdf.setFillGray(0.35)
        pdf.setFont("Helvetica", 7)
        pdf.drawString(margin, 12, str(pack.get("title", "Event")))
        pdf.drawRightString(page_width - margin, 12, f"Page {offset // (columns * rows) + 1}")
        pdf.showPage()
    pdf.save()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    with args.input.open(encoding="utf-8") as source:
        pack = json.load(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    render(pack, args.output)


if __name__ == "__main__":
    main()
