/**
 * Dessine les bounding boxes par-dessus une scène.
 *
 * Indispensable à la revue humaine et au spike : la qualité de localisation ne se
 * juge pas sur des chiffres, elle se voit. Une boîte qui englobe deux sujets ou
 * qui déborde sur le décor saute aux yeux ici et resterait invisible dans un JSON.
 */

import sharp from "sharp";
import type { BBox } from "../lib/types";

export interface OverlayBox {
  bbox: BBox;
  label?: string;
  /** Met en évidence la solution parmi les autres. */
  highlight?: boolean;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

export async function drawOverlay(
  image: Buffer,
  boxes: readonly OverlayBox[],
  outPath: string,
): Promise<void> {
  const { width = 0, height = 0 } = await sharp(image).metadata();
  const fontSize = Math.max(10, Math.round(width / 110));

  const shapes = boxes.map((box, i) => {
    const x = box.bbox.x * width;
    const y = box.bbox.y * height;
    const w = box.bbox.w * width;
    const h = box.bbox.h * height;
    const colour = box.highlight ? "#00e05a" : "#ff2d55";
    const stroke = box.highlight ? 5 : 2;
    const caption = box.label ? escapeXml(`${i}· ${box.label}`) : String(i);
    return `
      <rect x="${x}" y="${y}" width="${w}" height="${h}"
            fill="none" stroke="${colour}" stroke-width="${stroke}" />
      <rect x="${x}" y="${Math.max(0, y - fontSize - 4)}"
            width="${Math.min(caption.length * fontSize * 0.58 + 6, width - x)}"
            height="${fontSize + 4}" fill="${colour}" />
      <text x="${x + 3}" y="${Math.max(fontSize, y - 4)}"
            font-family="sans-serif" font-size="${fontSize}" fill="#ffffff">${caption}</text>`;
  }).join("");

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`;
  await sharp(image)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile(outPath);
}
