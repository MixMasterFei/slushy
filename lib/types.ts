/**
 * Contrat de types partagé entre le pipeline hors ligne (tools/) et le jeu (app/).
 *
 * Règle centrale : tout attribut utilisable comme indice appartient à un
 * **vocabulaire fermé**. Ces listes sont injectées telles quelles dans le schéma
 * JSON envoyé à Gemini, ce qui force le modèle à choisir dedans. Sans cette
 * contrainte, « rouge », « rouge vif » et « écarlate » seraient trois valeurs
 * distinctes, aucun objet ne se regrouperait et le solveur ne trouverait jamais
 * d'indice discriminant.
 *
 * Les clés sont des slugs neutres (anglais) ; l'affichage FR/EN vit dans clue-text.ts.
 */

// ---------------------------------------------------------------------------
// Vocabulaires fermés
// ---------------------------------------------------------------------------

export const KINDS = [
  "animal", "person", "vehicle", "food", "plant", "furniture", "object", "building",
] as const;

export const COLORS = [
  "red", "orange", "yellow", "green", "blue", "purple",
  "pink", "brown", "black", "white", "grey",
] as const;

export const SIZES = ["small", "medium", "large"] as const;

export const PATTERNS = ["plain", "striped", "dotted", "checkered", "floral"] as const;

export const ACCESSORIES = [
  "hat", "cap", "glasses", "scarf", "bag", "umbrella",
  "helmet", "bowtie", "crown", "gloves", "boots", "necklace",
] as const;

export const ACTIONS = [
  "standing", "sitting", "lying", "walking", "running", "jumping",
  "flying", "sleeping", "eating", "reading", "dancing", "swimming",
] as const;

export const ZONES_X = ["left", "center", "right"] as const;
export const ZONES_Y = ["top", "middle", "bottom"] as const;

export type Kind = (typeof KINDS)[number];
export type Color = (typeof COLORS)[number];
export type Size = (typeof SIZES)[number];
export type Pattern = (typeof PATTERNS)[number];
export type Accessory = (typeof ACCESSORIES)[number];
export type Action = (typeof ACTIONS)[number];
export type ZoneX = (typeof ZONES_X)[number];
export type ZoneY = (typeof ZONES_Y)[number];

/** Attributs sur lesquels un indice peut être construit. */
export const ATTRIBUTE_KEYS = [
  "kind", "color", "size", "pattern", "accessories", "action", "holding", "zoneX", "zoneY",
] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

// ---------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------

/** Boîte englobante normalisée en fractions [0,1] de la taille de l'image, origine en haut-gauche. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Gemini renvoie `[ymin, xmin, ymax, xmax]` mis à l'échelle 0-1000.
 * Notre modèle interne utilise {x,y,w,h} en fractions [0,1], directement
 * exploitable en CSS. Conversion isolée ici et couverte par des tests.
 */
export function bboxFromGemini(box2d: readonly number[]): BBox {
  if (box2d.length !== 4) {
    throw new Error(`box_2d attendu de longueur 4, reçu ${box2d.length}`);
  }
  const [ymin, xmin, ymax, xmax] = box2d;
  // Gemini inverse parfois min/max : on normalise plutôt que de produire une taille négative.
  const top = Math.min(ymin, ymax) / 1000;
  const bottom = Math.max(ymin, ymax) / 1000;
  const left = Math.min(xmin, xmax) / 1000;
  const right = Math.max(xmin, xmax) / 1000;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  // Les entrées sont des entiers sur 0-1000 : les vraies valeurs ont au plus
  // 3 décimales. Arrondir élimine le bruit flottant (0.6 - 0.2 = 0.3999…7) sans
  // perdre la moindre information, et garde les JSON publiés lisibles.
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  const x = clamp01(left);
  const y = clamp01(top);
  return { x: round(x), y: round(y), w: round(clamp01(right) - x), h: round(clamp01(bottom) - y) };
}

export function bboxCenter(b: BBox): { cx: number; cy: number } {
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
}

export function bboxArea(b: BBox): number {
  return Math.max(0, b.w) * Math.max(0, b.h);
}

/** Intersection-over-union — sert à apparier les objets entre passes et à valider la passe adverse. */
export function iou(a: BBox, b: BBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = bboxArea(a) + bboxArea(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

/** La zone est déduite du centre de la bbox, en code — jamais demandée au modèle. */
export function zoneOf(b: BBox): { zoneX: ZoneX; zoneY: ZoneY } {
  const { cx, cy } = bboxCenter(b);
  const zoneX: ZoneX = cx < 1 / 3 ? "left" : cx < 2 / 3 ? "center" : "right";
  const zoneY: ZoneY = cy < 1 / 3 ? "top" : cy < 2 / 3 ? "middle" : "bottom";
  return { zoneX, zoneY };
}

// ---------------------------------------------------------------------------
// Inventaire
// ---------------------------------------------------------------------------

/** Ce qu'une passe de description renvoie pour un crop (un seul objet). */
export interface ObjectAttributes {
  kind: Kind;
  color: Color;
  size: Size;
  pattern: Pattern;
  accessories: Accessory[];
  action: Action;
  holding: boolean;
}

/** Un objet de l'inventaire consolidé, après fusion des 3 passes. */
export interface InventoryObject extends ObjectAttributes {
  id: string;
  /** Libellé humain libre ("chat orange au chapeau melon") — pour la revue, jamais pour un indice. */
  label: string;
  bbox: BBox;
  zoneX: ZoneX;
  zoneY: ZoneY;
  /**
   * Attributs ayant obtenu un consensus unanime sur les 3 passes de description.
   * **Seuls ceux-ci peuvent servir d'indice** : c'est ce qui garantit l'équité du jeu.
   * Les autres restent présents (utiles à la revue) mais sont interdits au solveur.
   */
  confident: AttributeKey[];
}

export interface SceneInventory {
  sceneId: string;
  theme: string;
  image: { path: string; width: number; height: number };
  objects: InventoryObject[];
}

// ---------------------------------------------------------------------------
// Prédicats (indices)
// ---------------------------------------------------------------------------

/**
 * Un indice est une **donnée sérialisable**, pas une fonction : il doit survivre à
 * un aller-retour JSON, être rejoué à l'identique en test et rendu en FR comme en EN.
 * L'évaluation se fait via `matches()`.
 */
export type Predicate =
  | { attr: "kind"; value: Kind }
  | { attr: "color"; value: Color }
  | { attr: "size"; value: Size }
  | { attr: "pattern"; value: Pattern }
  | { attr: "accessories"; value: Accessory }
  | { attr: "action"; value: Action }
  | { attr: "holding"; value: boolean }
  | { attr: "zoneX"; value: ZoneX }
  | { attr: "zoneY"; value: ZoneY };

/** Attribut d'inventaire requis pour évaluer ce prédicat (pour le filtre `confident`). */
export function predicateAttribute(p: Predicate): AttributeKey {
  return p.attr;
}

/** Évaluation pure d'un prédicat sur un objet. Aucune I/O, aucun modèle. */
export function matches(p: Predicate, o: InventoryObject): boolean {
  switch (p.attr) {
    case "kind": return o.kind === p.value;
    case "color": return o.color === p.value;
    case "size": return o.size === p.value;
    case "pattern": return o.pattern === p.value;
    case "accessories": return o.accessories.includes(p.value);
    case "action": return o.action === p.value;
    case "holding": return o.holding === p.value;
    case "zoneX": return o.zoneX === p.value;
    case "zoneY": return o.zoneY === p.value;
  }
}

/** Objets satisfaisant *tous* les prédicats fournis. */
export function matchAll(preds: readonly Predicate[], objects: readonly InventoryObject[]): InventoryObject[] {
  return objects.filter((o) => preds.every((p) => matches(p, o)));
}

// ---------------------------------------------------------------------------
// Puzzle publié
// ---------------------------------------------------------------------------

export const CLUE_COUNT = 4;
export const MAX_ATTEMPTS = 5;

export type Locale = "fr" | "en";

/**
 * Ce qui part réellement au client. Volontairement minimal : ni inventaire, ni
 * leurres, ni prédicats. La bbox de la solution est obligatoirement présente
 * (il faut valider le clic hors ligne) — voir `solutionToken` dans lib/solution.ts
 * pour l'obfuscation légère qui l'accompagne.
 */
export interface Puzzle {
  number: number;
  date: string; // YYYY-MM-DD
  image: { src: string; width: number; height: number };
  /** Exactement CLUE_COUNT indices, dans l'ordre de révélation (du plus large au plus précis). */
  clues: Record<Locale, string[]>;
  solution: { token: string };
}

/**
 * Données de contrôle conservées hors du build : inventaire complet, prédicats,
 * distribution des leurres. Sert à la revue humaine et au débogage, jamais expédié.
 */
export interface PuzzleAudit {
  number: number;
  sceneId: string;
  theme: string;
  predicates: Predicate[];
  solutionId: string;
  solutionLabel: string;
  solutionBBox: BBox;
  /** Nombre d'objets satisfaisant 1, 2, 3 puis 4 indices — la courbe de resserrement. */
  narrowing: number[];
  /** Combien d'objets matchent exactement k indices, k = 0..4. Le « 0/1/2 leurres » du concept. */
  decoyHistogram: number[];
  inventory: SceneInventory;
}
