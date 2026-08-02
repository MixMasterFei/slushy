/**
 * Étape 2 — inventorier ce que l'image contient RÉELLEMENT.
 *
 * Découpé en deux temps délibérément séparés, parce que demander à un modèle de
 * décrire trente objets *et* de les localiser dans le même appel est exactement ce
 * qu'il fait de moins bien : les attributs migrent d'un sujet à l'autre (le
 * chapeau atterrit sur le mauvais chat) et les coordonnées dérivent.
 *
 *   (a) LOCALISER — un appel qui ne fait que détecter des régions. Tâche unique,
 *       sortie courte, résultat nettement plus stable.
 *   (b) DÉCRIRE  — un crop par région, un appel par crop. Un seul objet dans le
 *       cadre : plus aucune attribution croisée possible, et la bounding box est
 *       exacte puisqu'elle vient de (a).
 *
 * Trois passes indépendantes sur (b), puis vote à l'unanimité. Un attribut sur
 * lequel les trois passes ne s'accordent pas est déclaré INCERTAIN et devient
 * inutilisable comme indice — c'est ce qui garantit l'équité du jeu.
 *
 * `size` et `zone` ne sont jamais demandés au modèle : sur un crop isolé,
 * « petit ou grand ? » n'a aucun référentiel. Ils se déduisent en code de la
 * géométrie, ce qui les rend exacts et toujours certains.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { askJSON, mapWithConcurrency } from "./gemini";
import { DIRS, ensureDirs, parseArgs } from "./paths";
import {
  ACCESSORIES, ACTIONS, ATTRIBUTE_KEYS, COLORS, KINDS, PATTERNS,
  bboxArea, bboxFromGemini, iou, zoneOf,
  type AttributeKey, type BBox, type InventoryObject, type ObjectAttributes, type SceneInventory,
} from "../lib/types";

const DESCRIBE_PASSES = 3;
const MAX_OBJECTS = 45;
/** Aire relative en-dehors de laquelle une région n'est pas un sujet exploitable. */
const MIN_AREA = 0.0015;
const MAX_AREA = 0.25;
/** Deux régions qui se recouvrent à ce point désignent le même sujet. */
const DEDUPE_IOU = 0.55;

// ---------------------------------------------------------------------------
// (a) Localiser
// ---------------------------------------------------------------------------

const LOCATE_SCHEMA = {
  type: "object",
  properties: {
    objects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Nom court du sujet, en français" },
          box_2d: {
            type: "array",
            items: { type: "integer" },
            minItems: 4,
            maxItems: 4,
            description: "[ymin, xmin, ymax, xmax] mis à l'échelle 0-1000",
          },
        },
        required: ["label", "box_2d"],
      },
    },
  },
  required: ["objects"],
};

const LOCATE_PROMPT = `Détecte tous les sujets distincts de cette illustration :
personnages, animaux, véhicules, objets, plantes, meubles.

Règles :
- Une entrée par sujet individuel. Ne regroupe jamais plusieurs sujets dans une
  même boîte, même s'ils sont côte à côte ou identiques.
- N'inclus PAS le décor de fond (ciel, sol, murs, herbe, mer).
- Cadre chaque sujet au plus juste, accessoires compris.
- Ne renvoie que ce qui est réellement visible.`;

interface LocatedRegion {
  label: string;
  bbox: BBox;
}

export async function locateObjects(image: Buffer): Promise<LocatedRegion[]> {
  const result = await askJSON<{ objects: Array<{ label: string; box_2d: number[] }> }>({
    prompt: LOCATE_PROMPT,
    image,
    schema: LOCATE_SCHEMA,
  });

  const regions: LocatedRegion[] = [];
  for (const raw of result.objects ?? []) {
    let bbox: BBox;
    try {
      bbox = bboxFromGemini(raw.box_2d);
    } catch {
      continue; // boîte malformée : on l'ignore plutôt que de faire tomber le lot
    }
    const area = bboxArea(bbox);
    if (area < MIN_AREA || area > MAX_AREA) continue;
    // Une région extrêmement allongée est presque toujours un morceau de décor.
    if (bbox.w / bbox.h > 12 || bbox.h / bbox.w > 12) continue;
    regions.push({ label: raw.label.trim(), bbox });
  }

  return dedupe(regions).slice(0, MAX_OBJECTS);
}

/** Supprime les doublons : deux boîtes très recouvrantes désignent le même sujet. */
function dedupe(regions: LocatedRegion[]): LocatedRegion[] {
  const sorted = [...regions].sort((a, b) => bboxArea(b.bbox) - bboxArea(a.bbox));
  const kept: LocatedRegion[] = [];
  for (const region of sorted) {
    if (!kept.some((k) => iou(k.bbox, region.bbox) > DEDUPE_IOU)) kept.push(region);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// (b) Décrire, un crop à la fois
// ---------------------------------------------------------------------------

const DESCRIBE_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string", description: "Nom court du sujet, en français" },
    kind: { type: "string", enum: [...KINDS] },
    color: { type: "string", enum: [...COLORS], description: "Couleur dominante du sujet" },
    pattern: { type: "string", enum: [...PATTERNS] },
    accessories: { type: "array", items: { type: "string", enum: [...ACCESSORIES] } },
    action: { type: "string", enum: [...ACTIONS] },
    holding: { type: "boolean", description: "Le sujet tient-il un objet ?" },
  },
  required: ["label", "kind", "color", "pattern", "accessories", "action", "holding"],
};

const DESCRIBE_PROMPT = `Cette image est le gros plan d'UN SEUL sujet, au centre du cadre.

Décris uniquement ce sujet central, jamais ce qui dépasse sur les bords.

- color : la couleur dominante du sujet lui-même, pas celle du fond.
- accessories : uniquement ceux réellement visibles. Liste vide si aucun.
- holding : vrai seulement si le sujet tient visiblement quelque chose.
- En cas de doute sur un attribut, choisis la valeur la plus évidente ;
  ne tente pas de deviner un détail que tu ne distingues pas.`;

/** Découpe la région avec une marge : un sujet vu au ras du cadre se lit mal. */
async function cropRegion(image: Buffer, bbox: BBox, width: number, height: number): Promise<Buffer> {
  const pad = 0.08;
  const px = Math.round(Math.max(0, bbox.x - bbox.w * pad) * width);
  const py = Math.round(Math.max(0, bbox.y - bbox.h * pad) * height);
  const pw = Math.round(Math.min(1 - px / width, bbox.w * (1 + 2 * pad)) * width);
  const ph = Math.round(Math.min(1 - py / height, bbox.h * (1 + 2 * pad)) * height);

  return sharp(image)
    .extract({
      left: px, top: py,
      width: Math.max(8, Math.min(pw, width - px)),
      height: Math.max(8, Math.min(ph, height - py)),
    })
    // Agrandi si minuscule : un crop de 40 px ne se décrit pas.
    .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
}

type DescribePass = Omit<ObjectAttributes, "size"> & { label: string };

async function describeCrop(crop: Buffer, pass: number): Promise<DescribePass | null> {
  try {
    return await askJSON<DescribePass>({
      prompt: DESCRIBE_PROMPT,
      image: crop,
      schema: DESCRIBE_SCHEMA,
      // Températures distinctes : trois passes identiques ne testeraient rien.
      temperature: [0, 0.4, 0.8][pass] ?? 0.4,
    });
  } catch {
    return null; // une passe perdue n'invalide pas l'objet, elle le rend juste moins sûr
  }
}

// ---------------------------------------------------------------------------
// Vote
// ---------------------------------------------------------------------------

function normaliseAccessories(list: readonly string[]): string {
  return [...new Set(list)].sort().join(",");
}

/**
 * Fusionne les passes. Un attribut n'est déclaré certain que si **toutes** les
 * passes valides s'accordent — l'unanimité, pas la majorité : une valeur 2 contre 1
 * signale déjà que le modèle hésite, donc que le joueur hésitera aussi.
 */
function vote(passes: DescribePass[]): { attributes: Omit<ObjectAttributes, "size">; label: string; confident: AttributeKey[] } {
  const first = passes[0];
  const confident: AttributeKey[] = [];

  const agree = <T>(pick: (p: DescribePass) => T): boolean =>
    passes.every((p) => pick(p) === pick(first));

  if (agree((p) => p.kind)) confident.push("kind");
  if (agree((p) => p.color)) confident.push("color");
  if (agree((p) => p.pattern)) confident.push("pattern");
  if (agree((p) => p.action)) confident.push("action");
  if (agree((p) => p.holding)) confident.push("holding");
  if (passes.every((p) => normaliseAccessories(p.accessories) === normaliseAccessories(first.accessories))) {
    confident.push("accessories");
  }
  // Une seule passe valide ne prouve rien : sans corroboration, rien n'est certain.
  if (passes.length < 2) confident.length = 0;

  return {
    attributes: {
      kind: first.kind, color: first.color, pattern: first.pattern,
      accessories: first.accessories, action: first.action, holding: first.holding,
    },
    label: first.label,
    confident,
  };
}

/**
 * La taille se déduit de l'aire relative, par terciles sur la scène entière.
 * Calculée, donc exacte : toujours certaine.
 */
function assignSizes(areas: number[]): Array<"small" | "medium" | "large"> {
  const sorted = [...areas].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length / 3)];
  const hi = sorted[Math.floor((2 * sorted.length) / 3)];
  return areas.map((a) => (a <= lo ? "small" : a >= hi ? "large" : "medium"));
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function buildInventory(
  sceneId: string,
  theme: string,
  imagePath: string,
): Promise<SceneInventory> {
  const image = readFileSync(imagePath);
  const { width = 0, height = 0 } = await sharp(image).metadata();

  const regions = await locateObjects(image);
  if (regions.length === 0) throw new Error(`${sceneId} : aucune région détectée`);

  const described = await mapWithConcurrency(regions, 4, async (region) => {
    const crop = await cropRegion(image, region.bbox, width, height);
    const passes = (
      await Promise.all(
        Array.from({ length: DESCRIBE_PASSES }, (_, pass) => describeCrop(crop, pass)),
      )
    ).filter((p): p is DescribePass => p !== null);
    return passes.length === 0 ? null : { region, ...vote(passes) };
  });

  const usable = described.filter((d): d is NonNullable<typeof d> => d !== null);
  const sizes = assignSizes(usable.map((d) => bboxArea(d.region.bbox)));

  const objects: InventoryObject[] = usable.map((d, i) => ({
    id: `${sceneId}-${String(i).padStart(2, "0")}`,
    label: d.label || d.region.label,
    ...d.attributes,
    size: sizes[i],
    bbox: d.region.bbox,
    ...zoneOf(d.region.bbox),
    // size, zoneX et zoneY sont calculés en code : jamais incertains.
    confident: [...d.confident, "size", "zoneX", "zoneY"] as AttributeKey[],
  }));

  return { sceneId, theme, image: { path: imagePath, width, height }, objects };
}

/** Part des attributs jugés certains — l'indicateur go/no-go de la phase 1a. */
export function confidenceRate(inventory: SceneInventory): number {
  // Seuls les attributs issus du modèle comptent : inclure les attributs calculés
  // gonflerait artificiellement le score de ce qu'on cherche justement à mesurer.
  const modelKeys = ATTRIBUTE_KEYS.filter((k) => !["size", "zoneX", "zoneY"].includes(k));
  const total = inventory.objects.length * modelKeys.length;
  if (total === 0) return 0;
  const sure = inventory.objects.reduce(
    (n, o) => n + modelKeys.filter((k) => o.confident.includes(k)).length, 0);
  return sure / total;
}

async function main() {
  const args = parseArgs();
  const sceneId = String(args.scene ?? "");
  if (!sceneId) throw new Error("Usage : npm run inventory -- --scene <sceneId>");

  ensureDirs();
  const imagePath = join(DIRS.scenes, `${sceneId}.png`);
  const theme = sceneId.replace(/-\d+$/, "");

  console.log(`Inventaire de ${sceneId}…`);
  const inventory = await buildInventory(sceneId, theme, imagePath);
  const out = join(DIRS.inventories, `${sceneId}.json`);
  writeFileSync(out, JSON.stringify(inventory, null, 2));

  console.log(`  ✓ ${inventory.objects.length} objets → ${out}`);
  console.log(`  attributs certains : ${(confidenceRate(inventory) * 100).toFixed(0)} %`);
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
