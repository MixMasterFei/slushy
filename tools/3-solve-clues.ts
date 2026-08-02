/**
 * Solveur d'indices — le cœur du jeu.
 *
 * **Zéro IA, zéro I/O, entièrement déterministe.** La garantie « un seul objet
 * coche les 4 indices » est une propriété mathématique ; on ne la délègue pas à un
 * modèle de langage. Même inventaire en entrée ⇒ même puzzle en sortie, toujours.
 *
 * ---------------------------------------------------------------------------
 * Le point subtil : les attributs incertains sont *inconnus*, pas *absents*.
 * ---------------------------------------------------------------------------
 * Si les 3 passes de description ne s'accordent pas sur la couleur d'un objet, on
 * ne sait pas de quelle couleur il est — il *pourrait* être rouge. Se contenter de
 * « je ne l'utilise pas comme indice » ne suffit donc pas : cet objet reste un
 * second candidat possible pour un indice « De couleur rouge », et le puzzle
 * deviendrait ambigu pour le joueur.
 *
 * D'où deux masques par prédicat :
 *   - `definite` : les objets qui le satisfont à coup sûr (attribut confirmé + valeur égale)
 *   - `possible` : ceux qui pourraient le satisfaire (attribut confirmé et égal, OU inconnu)
 *
 * Un puzzle n'est accepté que si, sur l'intersection des 4 indices,
 * `possible === definite` et qu'il ne reste qu'un seul objet. Autrement dit :
 * l'unicité tient quelle que soit la vraie valeur des attributs incertains.
 */

import {
  ACCESSORIES, ACTIONS, COLORS, CLUE_COUNT, KINDS, PATTERNS, SIZES, ZONES_X, ZONES_Y,
  matches, type AttributeKey, type InventoryObject, type Predicate,
} from "../lib/types";

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

export interface SolverOptions {
  /**
   * Bornes [min, max] du nombre d'objets encore candidats après chaque indice.
   * C'est la courbe de difficulté : large au premier indice (on cherche partout),
   * resserrée ensuite, exactement 1 au quatrième.
   */
  narrowingBands: Array<[number, number]>;
  /**
   * Au moins autant d'indices DESCRIPTIFS — ceux qui disent ce qu'est l'objet ou
   * à quoi il ressemble (nature, couleur, motif, accessoire, action).
   *
   * Sans ce plancher, le solveur produit des puzzles techniquement valides mais
   * creux, du genre « à mi-hauteur · à gauche · grand · tient quelque chose » :
   * quatre indices, une solution unique, et pourtant rien qui donne envie de
   * chercher. Le joueur doit pouvoir se représenter sa cible.
   */
  minDescriptiveClues: number;
  /** Nombre maximum d'indices de position (zoneX / zoneY). */
  maxPositionalClues: number;
  /**
   * Le premier indice doit-il être descriptif ?
   *
   * Trié par largeur décroissante, l'ordre canonique met naturellement les indices
   * de position en tête — ils couvrent un tiers de la scène chacun. Le joueur
   * ouvrirait alors sa partie sur « à mi-hauteur » : une bande d'image à fixer,
   * sans savoir quoi y chercher. On veut l'inverse — savoir ce qu'on traque, puis
   * resserrer.
   */
  requireDescriptiveOpening: boolean;
  /**
   * Part maximale de la scène que le premier indice peut encore laisser en jeu.
   * Sans ce garde-fou, sur une petite scène un indice satisfait par *tous* les
   * objets passerait les bandes absolues tout en n'apprenant rien au joueur.
   */
  maxFirstClueRatio: number;
}

export const DEFAULT_OPTIONS: SolverOptions = {
  narrowingBands: [[8, 20], [3, 8], [2, 3], [1, 1]],
  minDescriptiveClues: 2,
  maxPositionalClues: 2,
  maxFirstClueRatio: 0.7,
  requireDescriptiveOpening: true,
};

/** Où se trouve l'objet — utile pour resserrer la zone de recherche, mais muet sur sa nature. */
const POSITIONAL: ReadonlySet<AttributeKey> = new Set<AttributeKey>(["zoneX", "zoneY"]);

/** Ce que l'objet EST ou ce à quoi il ressemble — la matière dont on fait une vraie énigme. */
const DESCRIPTIVE: ReadonlySet<AttributeKey> = new Set<AttributeKey>([
  "kind", "color", "pattern", "accessories", "action",
]);
// `size` et `holding` ne sont ni l'un ni l'autre : ils affinent sans identifier.

export interface SolvedPuzzle {
  predicates: Predicate[];
  solution: InventoryObject;
  /** Nombre de candidats restants après 1, 2, 3 puis 4 indices. */
  narrowing: number[];
  /** Combien d'objets satisfont exactement k indices, pour k = 0..4. */
  decoyHistogram: number[];
  score: number;
}

export interface SolveFailure {
  reason: string;
  /** Combien de quadruplets ont échoué sur chaque critère — sert à régler le pipeline. */
  rejections: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Masques de bits
// ---------------------------------------------------------------------------

function popcount(mask: bigint): number {
  let n = 0;
  let m = mask;
  while (m > 0n) {
    m &= m - 1n;
    n++;
  }
  return n;
}

interface MaskedPredicate {
  pred: Predicate;
  attr: AttributeKey;
  definite: bigint;
  possible: bigint;
  definiteCount: number;
}

/** Toutes les valeurs de vocabulaire réellement présentes donnent un prédicat candidat. */
function buildPredicateUniverse(objects: readonly InventoryObject[]): Predicate[] {
  const preds: Predicate[] = [];
  const present = <T>(values: readonly T[], pick: (o: InventoryObject) => T | T[]): T[] => {
    const seen = new Set<T>();
    for (const o of objects) {
      const v = pick(o);
      if (Array.isArray(v)) v.forEach((x) => seen.add(x));
      else seen.add(v);
    }
    return values.filter((v) => seen.has(v));
  };

  present(KINDS, (o) => o.kind).forEach((value) => preds.push({ attr: "kind", value }));
  present(COLORS, (o) => o.color).forEach((value) => preds.push({ attr: "color", value }));
  present(SIZES, (o) => o.size).forEach((value) => preds.push({ attr: "size", value }));
  present(PATTERNS, (o) => o.pattern).forEach((value) => preds.push({ attr: "pattern", value }));
  present(ACCESSORIES, (o) => o.accessories).forEach((value) => preds.push({ attr: "accessories", value }));
  present(ACTIONS, (o) => o.action).forEach((value) => preds.push({ attr: "action", value }));
  present(ZONES_X, (o) => o.zoneX).forEach((value) => preds.push({ attr: "zoneX", value }));
  present(ZONES_Y, (o) => o.zoneY).forEach((value) => preds.push({ attr: "zoneY", value }));
  preds.push({ attr: "holding", value: true }, { attr: "holding", value: false });

  return preds;
}

function maskPredicates(
  preds: readonly Predicate[],
  objects: readonly InventoryObject[],
): MaskedPredicate[] {
  return preds.map((pred) => {
    let definite = 0n;
    let possible = 0n;
    objects.forEach((o, i) => {
      const bit = 1n << BigInt(i);
      const known = o.confident.includes(pred.attr);
      const equal = matches(pred, o);
      if (known && equal) definite |= bit;
      // Attribut incertain ⇒ l'objet pourrait satisfaire l'indice : il reste un
      // concurrent potentiel, et c'est exactement ce qu'on doit exclure.
      if (!known || equal) possible |= bit;
    });
    return { pred, attr: pred.attr, definite, possible, definiteCount: popcount(definite) };
  });
}

// ---------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------

/** Toutes les combinaisons de `k` éléments parmi `items`, dans un ordre déterministe. */
function* combinations<T>(items: readonly T[], k: number): Generator<T[]> {
  const idx = Array.from({ length: k }, (_, i) => i);
  if (items.length < k) return;
  for (;;) {
    yield idx.map((i) => items[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === items.length - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

export function solveClues(
  objects: readonly InventoryObject[],
  options: SolverOptions = DEFAULT_OPTIONS,
): { ok: true; puzzle: SolvedPuzzle } | { ok: false; failure: SolveFailure } {
  const rejections: Record<string, number> = {
    tooFewObjects: 0, notUnique: 0, ambiguous: 0, redundant: 0,
    narrowing: 0, axisDiversity: 0,
  };

  if (objects.length < 8) {
    rejections.tooFewObjects++;
    return { ok: false, failure: { reason: `inventaire trop petit (${objects.length} objets)`, rejections } };
  }

  const universe = maskPredicates(buildPredicateUniverse(objects), objects);
  let best: SolvedPuzzle | null = null;

  for (let s = 0; s < objects.length; s++) {
    const solution = objects[s];
    const bit = 1n << BigInt(s);

    // Seuls les prédicats que CETTE solution satisfait de façon certaine sont
    // recevables : un indice ne peut pas reposer sur un attribut douteux de la réponse.
    const satisfied = universe.filter((mp) => (mp.definite & bit) !== 0n);
    if (satisfied.length < CLUE_COUNT) continue;

    for (const combo of combinations(satisfied, CLUE_COUNT)) {
      // --- diversité des axes -------------------------------------------------
      const attrs = combo.map((m) => m.attr);
      const positional = attrs.filter((a) => POSITIONAL.has(a)).length;
      const descriptive = attrs.filter((a) => DESCRIPTIVE.has(a)).length;
      if (positional > options.maxPositionalClues || descriptive < options.minDescriptiveClues) {
        rejections.axisDiversity++;
        continue;
      }
      // Un objet n'a qu'une couleur, qu'une taille… : deux indices sur le même axe
      // seraient contradictoires ou redondants. Seuls les accessoires se cumulent.
      const nonAccessory = attrs.filter((a) => a !== "accessories");
      if (new Set(nonAccessory).size !== nonAccessory.length) {
        rejections.axisDiversity++;
        continue;
      }

      // --- unicité ------------------------------------------------------------
      let defAll = -1n;
      let posAll = -1n;
      for (const m of combo) {
        defAll &= m.definite;
        posAll &= m.possible;
      }
      if (popcount(defAll) !== 1) { rejections.notUnique++; continue; }
      // Aucun objet « peut-être conforme » ne doit subsister : sinon le puzzle est
      // ambigu dès que l'attribut incertain prend la mauvaise valeur.
      if (posAll !== defAll) { rejections.ambiguous++; continue; }

      // --- courbe de resserrement ---------------------------------------------
      // Ordre canonique : du plus large au plus précis. Le joueur commence par
      // ratisser large, puis resserre — et l'ordre est reproductible.
      const byBreadth = [...combo].sort((a, b) =>
        b.definiteCount - a.definiteCount || predKey(a.pred).localeCompare(predKey(b.pred)));

      let ordered = byBreadth;
      if (options.requireDescriptiveOpening) {
        // minDescriptiveClues ≥ 1 garantit qu'il en existe un.
        const opener = byBreadth.find((m) => DESCRIPTIVE.has(m.attr))!;
        ordered = [opener, ...byBreadth.filter((m) => m !== opener)];
      }

      const narrowing: number[] = [];
      let acc = -1n;
      let reject: "narrowing" | "redundant" | null = null;
      for (let i = 0; i < ordered.length && !reject; i++) {
        acc &= ordered[i].definite;
        const count = popcount(acc);
        // Non-redondance réelle : le long du chemin de révélation, chaque indice
        // doit éliminer au moins un candidat. Un indice qui ne retire rien est du
        // remplissage, et le joueur le ressent comme tel.
        if (i > 0 && count >= narrowing[i - 1]) { reject = "redundant"; break; }
        const [lo, hi] = options.narrowingBands[i];
        if (count < lo || count > hi) { reject = "narrowing"; break; }
        // Le premier indice doit réellement écarter du monde, pas seulement
        // décrire la scène entière.
        if (i === 0 && count > objects.length * options.maxFirstClueRatio) {
          reject = "narrowing"; break;
        }
        narrowing.push(count);
      }
      if (reject) { rejections[reject]++; continue; }

      const predicates = ordered.map((m) => m.pred);
      const histogram = decoyHistogram(predicates, objects);
      const score = scorePuzzle(narrowing, histogram, attrs, isFullyIrreducible(combo));
      if (!best || score > best.score) {
        // defAll ne contient qu'un bit, et celui de `solution` y est forcément
        // (on n'a retenu que des prédicats qu'elle satisfait) : c'est donc elle.
        best = { predicates, solution, narrowing, decoyHistogram: histogram, score };
      }
    }
  }

  if (!best) {
    const worst = Object.entries(rejections).sort((a, b) => b[1] - a[1])[0];
    return {
      ok: false,
      failure: {
        reason: `aucun quadruplet valide (blocage principal : ${worst[0]} × ${worst[1]})`,
        rejections,
      },
    };
  }
  return { ok: true, puzzle: best };
}

function predKey(p: Predicate): string {
  return `${p.attr}:${String("value" in p ? p.value : "")}`;
}

/** Combien d'objets satisfont exactement k indices — le « 0, 1 ou 2 indices » du concept. */
export function decoyHistogram(
  predicates: readonly Predicate[],
  objects: readonly InventoryObject[],
): number[] {
  const hist = new Array<number>(predicates.length + 1).fill(0);
  for (const o of objects) {
    const n = predicates.filter((p) => o.confident.includes(p.attr) && matches(p, o)).length;
    hist[n]++;
  }
  return hist;
}

/**
 * Un puzzle est « pleinement irréductible » si aucun sous-ensemble de 3 indices
 * n'isole déjà la solution — les quatre sont alors nécessaires quel que soit
 * l'ordre. Ce n'est pas exigé (le joueur ne voit que des préfixes, déjà contraints
 * par la courbe), mais c'est plus élégant, donc bonifié au score.
 */
function isFullyIrreducible(combo: readonly MaskedPredicate[]): boolean {
  for (let i = 0; i < combo.length; i++) {
    let without = -1n;
    for (let j = 0; j < combo.length; j++) if (j !== i) without &= combo[j].definite;
    if (popcount(without) <= 1) return false;
  }
  return true;
}

/**
 * Qualité d'un puzzle valide, à unicité déjà garantie. On privilégie :
 *  - des indices qui DÉCRIVENT l'objet — le joueur doit pouvoir se le représenter
 *    avant de le chercher, sinon il balaie la scène au hasard ;
 *  - un vrai suspense final (des leurres à 3/4 indices, qui obligent au dernier indice) ;
 *  - une variété d'axes (couleur + accessoire + action vaut mieux que trois couleurs) ;
 *  - les puzzles dont les 4 indices sont tous indispensables ;
 *  - un premier indice large, pour que la scène s'explore vraiment.
 */
function scorePuzzle(
  narrowing: number[],
  histogram: number[],
  attrs: AttributeKey[],
  irreducible: boolean,
): number {
  const nearMisses = histogram[histogram.length - 2] ?? 0; // objets à 3 indices sur 4
  const descriptive = attrs.filter((a) => DESCRIPTIVE.has(a)).length;
  const variety = new Set(attrs).size;
  const opening = narrowing[0];
  return descriptive * 14
    + nearMisses * 10
    + variety * 5
    + (irreducible ? 12 : 0)
    + Math.min(opening, 15);
}
