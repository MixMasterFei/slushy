/**
 * Scène de test synthétique — échafaudage de développement, PAS le produit.
 *
 * Dessine une scène en SVG dont les attributs sont connus par construction, puis
 * la fait passer par le VRAI solveur et la VRAIE publication. Cela valide toute la
 * chaîne — solveur → rédaction des indices → encodage de la solution → JSON publié
 * → chargement côté client — sans dépendre de la clé API ni du pipeline Gemini.
 *
 * Le rendu est volontairement rudimentaire : ces figures géométriques n'ont pas
 * vocation à ressembler au jeu final. Elles seront remplacées par les scènes
 * illustrées de Gemini dès que la clé sera disponible ; rien d'autre ne changera,
 * puisque le contrat de données est identique.
 *
 *   npm run fixture
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { solveClues } from "./3-solve-clues";
import { publishCandidate, type Candidate } from "./5-publish";
import { DIRS, ensureDirs } from "./paths";
import { clueText } from "../lib/clue-text";
import { puzzleNumberFor } from "../lib/puzzle";
import {
  COLORS, PATTERNS, ATTRIBUTE_KEYS,
  bboxArea, zoneOf,
  type Accessory, type Action, type AttributeKey, type Color, type InventoryObject,
  type Kind, type Pattern, type SceneInventory,
} from "../lib/types";

const WIDTH = 1920;
const HEIGHT = 1080;
const COLS = 8;
const ROWS = 4;

const HEX: Record<Color, string> = {
  red: "#e23b3b", orange: "#f08a24", yellow: "#f5c518", green: "#3ba55d",
  blue: "#3b7fe2", purple: "#8a4fd1", pink: "#f06fa8", brown: "#8b5e3c",
  black: "#2b2b2b", white: "#f4f4f4", grey: "#9aa0a6",
};

/** PRNG déterministe : la même graine doit toujours donner la même scène. */
function rng(seed: number) {
  let s = (seed || 1) >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

interface Figure {
  cx: number; cy: number; r: number;
  kind: Kind; color: Color; pattern: Pattern;
  accessories: Accessory[]; action: Action; holding: boolean;
}

/** Sous-ensembles lisibles en géométrie simple : inutile de dessiner « en train de nager ». */
const DRAWABLE_KINDS: Kind[] = ["animal", "person", "vehicle", "plant", "object"];
const DRAWABLE_ACCESSORIES: Accessory[] = ["hat", "glasses", "scarf", "bag", "crown"];
const DRAWABLE_ACTIONS: Action[] = ["standing", "sitting", "jumping", "sleeping", "running"];

function buildFigures(seed: number): Figure[] {
  const r = rng(seed);
  const pick = <T>(arr: readonly T[]): T => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
  const figures: Figure[] = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cellW = WIDTH / COLS;
      const cellH = HEIGHT / ROWS;
      // Jitter modéré : la scène respire sans que deux figures se chevauchent.
      const cx = col * cellW + cellW / 2 + (r() - 0.5) * cellW * 0.25;
      const cy = row * cellH + cellH / 2 + (r() - 0.5) * cellH * 0.25;
      const radius = 28 + r() * 34;

      const accessories: Accessory[] = [];
      if (r() < 0.55) accessories.push(pick(DRAWABLE_ACCESSORIES));
      if (r() < 0.18) {
        const extra = pick(DRAWABLE_ACCESSORIES);
        if (!accessories.includes(extra)) accessories.push(extra);
      }

      figures.push({
        cx, cy, r: radius,
        kind: pick(DRAWABLE_KINDS),
        color: pick(COLORS),
        pattern: r() < 0.55 ? "plain" : pick(PATTERNS),
        accessories,
        action: pick(DRAWABLE_ACTIONS),
        holding: r() < 0.35,
      });
    }
  }
  return figures;
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

function patternDefs(): string {
  return `<defs>
    <pattern id="striped" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="5" height="10" fill="rgba(0,0,0,0.28)"/>
    </pattern>
    <pattern id="dotted" width="12" height="12" patternUnits="userSpaceOnUse">
      <circle cx="4" cy="4" r="2.6" fill="rgba(0,0,0,0.3)"/>
    </pattern>
    <pattern id="checkered" width="14" height="14" patternUnits="userSpaceOnUse">
      <rect width="7" height="7" fill="rgba(0,0,0,0.28)"/>
      <rect x="7" y="7" width="7" height="7" fill="rgba(0,0,0,0.28)"/>
    </pattern>
    <pattern id="floral" width="16" height="16" patternUnits="userSpaceOnUse">
      <circle cx="8" cy="8" r="3" fill="rgba(255,255,255,0.55)"/>
      <circle cx="8" cy="3" r="1.8" fill="rgba(0,0,0,0.22)"/>
      <circle cx="8" cy="13" r="1.8" fill="rgba(0,0,0,0.22)"/>
      <circle cx="3" cy="8" r="1.8" fill="rgba(0,0,0,0.22)"/>
      <circle cx="13" cy="8" r="1.8" fill="rgba(0,0,0,0.22)"/>
    </pattern>
  </defs>`;
}

function bodyShape(f: Figure): string {
  const { cx, cy, r, kind } = f;
  switch (kind) {
    case "animal":
      // corps rond + deux oreilles
      return `<circle cx="${cx}" cy="${cy}" r="${r}"/>
              <polygon points="${cx - r * 0.7},${cy - r * 0.7} ${cx - r * 0.15},${cy - r * 1.35} ${cx - r * 0.05},${cy - r * 0.6}"/>
              <polygon points="${cx + r * 0.7},${cy - r * 0.7} ${cx + r * 0.15},${cy - r * 1.35} ${cx + r * 0.05},${cy - r * 0.6}"/>`;
    case "person":
      return `<circle cx="${cx}" cy="${cy - r * 0.55}" r="${r * 0.45}"/>
              <rect x="${cx - r * 0.55}" y="${cy - r * 0.15}" width="${r * 1.1}" height="${r * 1.15}" rx="${r * 0.2}"/>`;
    case "vehicle":
      return `<rect x="${cx - r}" y="${cy - r * 0.55}" width="${r * 2}" height="${r * 0.95}" rx="${r * 0.22}"/>
              <circle cx="${cx - r * 0.55}" cy="${cy + r * 0.5}" r="${r * 0.28}"/>
              <circle cx="${cx + r * 0.55}" cy="${cy + r * 0.5}" r="${r * 0.28}"/>`;
    case "plant":
      return `<rect x="${cx - r * 0.12}" y="${cy - r * 0.1}" width="${r * 0.24}" height="${r}"/>
              <ellipse cx="${cx - r * 0.45}" cy="${cy - r * 0.35}" rx="${r * 0.45}" ry="${r * 0.26}"/>
              <ellipse cx="${cx + r * 0.45}" cy="${cy - r * 0.35}" rx="${r * 0.45}" ry="${r * 0.26}"/>
              <circle cx="${cx}" cy="${cy - r * 0.75}" r="${r * 0.34}"/>`;
    default:
      return `<rect x="${cx - r * 0.8}" y="${cy - r * 0.8}" width="${r * 1.6}" height="${r * 1.6}" rx="${r * 0.18}"/>`;
  }
}

function accessoryShapes(f: Figure): string {
  const { cx, cy, r } = f;
  let svg = "";
  for (const acc of f.accessories) {
    switch (acc) {
      case "hat":
        svg += `<polygon points="${cx - r * 0.75},${cy - r * 0.85} ${cx + r * 0.75},${cy - r * 0.85} ${cx},${cy - r * 1.75}" fill="#2b2b2b"/>`;
        break;
      case "crown":
        svg += `<polygon points="${cx - r * 0.6},${cy - r * 0.85} ${cx - r * 0.6},${cy - r * 1.4} ${cx - r * 0.2},${cy - r * 1.0} ${cx},${cy - r * 1.5} ${cx + r * 0.2},${cy - r * 1.0} ${cx + r * 0.6},${cy - r * 1.4} ${cx + r * 0.6},${cy - r * 0.85}" fill="#f5c518"/>`;
        break;
      case "glasses":
        svg += `<circle cx="${cx - r * 0.3}" cy="${cy - r * 0.15}" r="${r * 0.22}" fill="#ffffff" stroke="#2b2b2b" stroke-width="3"/>
                <circle cx="${cx + r * 0.3}" cy="${cy - r * 0.15}" r="${r * 0.22}" fill="#ffffff" stroke="#2b2b2b" stroke-width="3"/>`;
        break;
      case "scarf":
        svg += `<rect x="${cx - r * 0.85}" y="${cy + r * 0.35}" width="${r * 1.7}" height="${r * 0.3}" rx="${r * 0.12}" fill="#e23b3b"/>`;
        break;
      case "bag":
        svg += `<rect x="${cx + r * 0.55}" y="${cy + r * 0.05}" width="${r * 0.55}" height="${r * 0.6}" rx="${r * 0.1}" fill="#8b5e3c"/>`;
        break;
      default:
        break;
    }
  }
  if (f.holding) {
    svg += `<circle cx="${cx - r * 0.95}" cy="${cy + r * 0.35}" r="${r * 0.22}" fill="#3ba55d" stroke="#1d1d1d" stroke-width="2"/>`;
  }
  return svg;
}

/** Petit marqueur de posture : la scène doit rester lisible, pas réaliste. */
function actionTransform(f: Figure): string {
  switch (f.action) {
    case "jumping": return `translate(0, ${-f.r * 0.28})`;
    case "sitting": return `translate(0, ${f.r * 0.2}) scale(1, 0.82)`;
    case "sleeping": return `rotate(-78, ${f.cx}, ${f.cy})`;
    case "running": return `skewX(-12)`;
    default: return "";
  }
}

function renderSVG(figures: Figure[]): string {
  const bodies = figures.map((f) => {
    const fill = HEX[f.color];
    const transform = actionTransform(f);
    const patternOverlay = f.pattern === "plain" ? "" :
      `<g fill="url(#${f.pattern})">${bodyShape(f)}</g>`;
    return `<g ${transform ? `transform="${transform}"` : ""}>
      <g fill="${fill}" stroke="#1d1d1d" stroke-width="3">${bodyShape(f)}</g>
      ${patternOverlay}
      ${accessoryShapes(f)}
    </g>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    ${patternDefs()}
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#f2ede3"/>
    ${bodies}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Inventaire — connu par construction, aucun modèle sollicité
// ---------------------------------------------------------------------------

function figureBBox(f: Figure) {
  // Enveloppe généreuse : elle doit couvrir le corps ET les accessoires
  // (chapeau au-dessus, sac sur le côté), sinon le clic tomberait à côté.
  const left = (f.cx - f.r * 1.15) / WIDTH;
  const top = (f.cy - f.r * 1.8) / HEIGHT;
  const right = (f.cx + f.r * 1.25) / WIDTH;
  const bottom = (f.cy + f.r * 1.25) / HEIGHT;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x = clamp(left), y = clamp(top);
  return { x, y, w: clamp(right) - x, h: clamp(bottom) - y };
}

function buildInventory(sceneId: string, figures: Figure[], imagePath: string): SceneInventory {
  const boxes = figures.map(figureBBox);
  const areas = boxes.map(bboxArea);
  const sorted = [...areas].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length / 3)];
  const hi = sorted[Math.floor((2 * sorted.length) / 3)];

  const objects: InventoryObject[] = figures.map((f, i) => ({
    id: `${sceneId}-${String(i).padStart(2, "0")}`,
    label: `${f.kind} ${f.color}${f.accessories.length ? ` (${f.accessories.join(", ")})` : ""}`,
    kind: f.kind, color: f.color, pattern: f.pattern,
    accessories: f.accessories, action: f.action, holding: f.holding,
    size: areas[i] <= lo ? "small" : areas[i] >= hi ? "large" : "medium",
    bbox: boxes[i],
    ...zoneOf(boxes[i]),
    // Scène synthétique : tout est connu avec certitude, aucune passe de vote.
    confident: [...ATTRIBUTE_KEYS] as AttributeKey[],
  }));

  return {
    sceneId, theme: "fixture",
    image: { path: imagePath, width: WIDTH, height: HEIGHT },
    objects,
  };
}

// ---------------------------------------------------------------------------

async function main() {
  ensureDirs();

  // On cherche une graine dont le solveur tire un puzzle propre : c'est le
  // fonctionnement normal du pipeline, rejet compris.
  for (let seed = 1; seed <= 200; seed++) {
    const figures = buildFigures(seed);
    const sceneId = `fixture-${String(seed).padStart(3, "0")}`;
    const imagePath = join(DIRS.scenes, `${sceneId}.png`);
    const inventory = buildInventory(sceneId, figures, imagePath);

    const solved = solveClues(inventory.objects);
    if (!solved.ok) continue;

    const png = await sharp(Buffer.from(renderSVG(figures))).png().toBuffer();
    writeFileSync(imagePath, png);

    const candidate: Candidate = {
      sceneId, theme: "fixture", imagePath,
      imageSha256: createHash("sha256").update(png).digest("hex"),
      predicates: solved.puzzle.predicates,
      solutionId: solved.puzzle.solution.id,
      solutionLabel: solved.puzzle.solution.label,
      solutionBBox: solved.puzzle.solution.bbox,
      narrowing: solved.puzzle.narrowing,
      decoyHistogram: solved.puzzle.decoyHistogram,
      inventory,
    };

    // Publiée pour AUJOURD'HUI, pas en dur au n° 1 : sinon la scène de test
    // devient injouable dès le lendemain et le jeu affiche « aucun puzzle ».
    const number = puzzleNumberFor(new Date());
    const puzzle = await publishCandidate(candidate, number);
    console.log(`Scène de test publiée en puzzle n° ${number} (graine ${seed}, ${figures.length} figures).`);
    console.log(`  image     : public${puzzle.image.src}`);
    solved.puzzle.predicates.forEach((p, i) => console.log(`  indice ${i + 1} : ${clueText(p, "fr")}`));
    console.log(`  solution  : « ${solved.puzzle.solution.label} »`);
    console.log(`  courbe    : ${solved.puzzle.narrowing.join(" → ")}`);
    console.log(`  leurres   : ${solved.puzzle.decoyHistogram.map((n, k) => `${k}★=${n}`).join("  ")}`);
    return;
  }

  throw new Error("Aucune graine n'a produit de puzzle valide — assouplir les bandes du solveur.");
}

main().catch((error) => { console.error(error); process.exit(1); });
