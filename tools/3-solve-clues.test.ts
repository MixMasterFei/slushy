import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, decoyHistogram, solveClues } from "./3-solve-clues";
import {
  ACCESSORIES, ACTIONS, ATTRIBUTE_KEYS, COLORS, KINDS, PATTERNS, SIZES,
  matches, zoneOf,
  type AttributeKey, type BBox, type InventoryObject, type Predicate,
} from "../lib/types";

// ---------------------------------------------------------------------------
// Fabriques
// ---------------------------------------------------------------------------

let counter = 0;
function obj(partial: Partial<InventoryObject> = {}): InventoryObject {
  const bbox: BBox = partial.bbox ?? { x: 0.4, y: 0.4, w: 0.05, h: 0.05 };
  return {
    id: partial.id ?? `o${counter++}`,
    label: partial.label ?? "objet",
    kind: partial.kind ?? "object",
    color: partial.color ?? "grey",
    size: partial.size ?? "medium",
    pattern: partial.pattern ?? "plain",
    accessories: partial.accessories ?? [],
    action: partial.action ?? "standing",
    holding: partial.holding ?? false,
    bbox,
    ...zoneOf(bbox),
    confident: partial.confident ?? [...ATTRIBUTE_KEYS],
    ...(partial.zoneX ? { zoneX: partial.zoneX } : {}),
    ...(partial.zoneY ? { zoneY: partial.zoneY } : {}),
  };
}

/** PRNG déterministe : les tests de propriété doivent être reproductibles. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

function randomInventory(seed: number, size: number, confidenceRate: number): InventoryObject[] {
  const r = rng(seed);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length) % arr.length];
  // Les id sont dérivés de l'index, pas d'un compteur global : deux appels avec la
  // même graine doivent produire un inventaire strictement identique.
  return Array.from({ length: size }, (_, i) => {
    const bbox: BBox = { x: r() * 0.9, y: r() * 0.9, w: 0.05, h: 0.05 };
    const confident = ATTRIBUTE_KEYS.filter(() => r() < confidenceRate);
    return obj({
      id: `s${seed}-${i}`,
      kind: pick(KINDS), color: pick(COLORS), size: pick(SIZES), pattern: pick(PATTERNS),
      accessories: r() < 0.5 ? [pick(ACCESSORIES)] : [],
      action: pick(ACTIONS), holding: r() < 0.4, bbox,
      confident: confident as AttributeKey[],
    });
  });
}

/**
 * Scène structurée d'une trentaine d'objets, à l'image de ce que le pipeline
 * produira : des attributs qui se recoupent en groupes, pas du bruit pur.
 */
function structuredScene(size = 30): InventoryObject[] {
  return Array.from({ length: size }, (_, i) =>
    obj({
      id: `struct-${i}`,
      kind: KINDS[i % 3],
      color: COLORS[i % 5],
      size: SIZES[i % 3],
      pattern: PATTERNS[i % 4],
      accessories: i % 2 === 0 ? [ACCESSORIES[i % 6]] : [],
      action: ACTIONS[i % 7],
      holding: i % 3 === 0,
      bbox: { x: (i % 6) * 0.16, y: Math.floor(i / 6) * 0.19, w: 0.05, h: 0.05 },
    }));
}

/** Reformule la garantie indépendamment du solveur, pour la vérifier de l'extérieur. */
function certainMatches(preds: readonly Predicate[], objects: readonly InventoryObject[]) {
  return objects.filter((o) => preds.every((p) => o.confident.includes(p.attr) && matches(p, o)));
}
function conceivableMatches(preds: readonly Predicate[], objects: readonly InventoryObject[]) {
  return objects.filter((o) => preds.every((p) => !o.confident.includes(p.attr) || matches(p, o)));
}

// ---------------------------------------------------------------------------

describe("solveClues — la garantie d'unicité", () => {
  it("trouve un puzzle sur une scène structurée de taille réaliste", () => {
    const objects = structuredScene(30);
    const result = solveClues(objects);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.puzzle.predicates).toHaveLength(4);
    expect(certainMatches(result.puzzle.predicates, objects)).toHaveLength(1);
    expect(result.puzzle.decoyHistogram[4]).toBe(1);
  });

  it("échoue avec un diagnostic exploitable plutôt qu'un puzzle bancal", () => {
    // Les bandes par défaut visent des scènes de 25-40 objets. Sur une scène trop
    // petite le solveur doit renoncer, et surtout DIRE sur quel critère il a buté :
    // c'est ce qui permettra de régler le prompt de génération après le premier lot.
    const result = solveClues(structuredScene(12));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toMatch(/\S/);
    expect(Object.values(result.failure.rejections).some((n) => n > 0)).toBe(true);
  });

  it("honore les options passées", () => {
    // Interdire toute position doit réellement produire des indices sans position…
    const noPosition = solveClues(randomInventory(3, 30, 0.95), {
      ...DEFAULT_OPTIONS, maxPositionalClues: 0,
    });
    if (noPosition.ok) {
      const attrs = noPosition.puzzle.predicates.map((p) => p.attr);
      expect(attrs.some((a) => a === "zoneX" || a === "zoneY")).toBe(false);
    }
    // …et exiger 4 indices descriptifs doit n'en produire que des descriptifs.
    const allDescriptive = solveClues(randomInventory(3, 30, 0.95), {
      ...DEFAULT_OPTIONS, minDescriptiveClues: 4,
    });
    if (allDescriptive.ok) {
      const descriptive = new Set(["kind", "color", "pattern", "accessories", "action"]);
      expect(allDescriptive.puzzle.predicates.every((p) => descriptive.has(p.attr))).toBe(true);
    }
  });

  it("ouvre toujours sur un indice descriptif", () => {
    // Le joueur doit savoir QUOI chercher avant OÙ chercher.
    const descriptive = new Set(["kind", "color", "pattern", "accessories", "action"]);
    let checked = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const result = solveClues(randomInventory(seed, 28, 0.9));
      if (!result.ok) continue;
      checked++;
      expect(descriptive.has(result.puzzle.predicates[0].attr)).toBe(true);
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("PROPRIÉTÉ : tout puzzle renvoyé a exactement une solution certaine ET une seule solution concevable", () => {
    let solved = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const objects = randomInventory(seed, 12 + (seed % 25), 0.55 + (seed % 45) / 100);
      const result = solveClues(objects);
      if (!result.ok) continue;
      solved++;
      const { predicates } = result.puzzle;

      // La solution est unique…
      expect(certainMatches(predicates, objects)).toHaveLength(1);
      // …et aucun objet aux attributs incertains ne peut lui disputer la place.
      expect(conceivableMatches(predicates, objects)).toHaveLength(1);
      // La solution annoncée est bien celle-là.
      expect(certainMatches(predicates, objects)[0].id).toBe(result.puzzle.solution.id);
    }
    // Le test ne vaut que s'il a réellement exercé le solveur.
    expect(solved).toBeGreaterThan(20);
  });

  it("PROPRIÉTÉ : chaque indice élimine au moins un candidat sur le chemin de révélation", () => {
    // C'est la non-redondance qui compte réellement : le joueur ne voit jamais que
    // des préfixes (indice 1, puis 1+2, puis 1+2+3). Un indice qui n'éliminerait
    // personne à son tour serait du remplissage.
    let checked = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const objects = randomInventory(seed, 20, 0.85);
      const result = solveClues(objects);
      if (!result.ok) continue;
      checked++;
      const { predicates, narrowing } = result.puzzle;
      for (let i = 1; i <= predicates.length; i++) {
        const prefix = predicates.slice(0, i);
        expect(certainMatches(prefix, objects)).toHaveLength(narrowing[i - 1]);
      }
      for (let i = 1; i < narrowing.length; i++) {
        expect(narrowing[i]).toBeLessThan(narrowing[i - 1]);
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("respecte la courbe de resserrement annoncée", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const result = solveClues(randomInventory(seed, 25, 0.9));
      if (!result.ok) continue;
      const { narrowing } = result.puzzle;
      expect(narrowing).toHaveLength(4);
      narrowing.forEach((count, i) => {
        const [lo, hi] = DEFAULT_OPTIONS.narrowingBands[i];
        expect(count).toBeGreaterThanOrEqual(lo);
        expect(count).toBeLessThanOrEqual(hi);
      });
      // Monotone décroissante : chaque indice ne peut que réduire le champ.
      for (let i = 1; i < narrowing.length; i++) {
        expect(narrowing[i]).toBeLessThanOrEqual(narrowing[i - 1]);
      }
    }
  });

  it("n'utilise jamais un attribut incertain comme indice", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const objects = randomInventory(seed, 22, 0.6);
      const result = solveClues(objects);
      if (!result.ok) continue;
      for (const p of result.puzzle.predicates) {
        expect(result.puzzle.solution.confident).toContain(p.attr);
      }
    }
  });

  it("garantit au moins 2 indices descriptifs et au plus 2 de position", () => {
    // Un puzzle « à mi-hauteur · à gauche · grand · tient quelque chose » est
    // techniquement valide et pourtant creux : rien n'y décrit la cible. Le
    // plancher d'indices descriptifs existe précisément pour l'interdire.
    const descriptive = new Set(["kind", "color", "pattern", "accessories", "action"]);
    let checked = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const result = solveClues(randomInventory(seed, 22, 0.9));
      if (!result.ok) continue;
      checked++;
      const attrs = result.puzzle.predicates.map((p) => p.attr);
      expect(attrs.filter((a) => a === "zoneX" || a === "zoneY").length).toBeLessThanOrEqual(2);
      expect(attrs.filter((a) => descriptive.has(a)).length).toBeGreaterThanOrEqual(2);
      // Pas deux indices sur un axe à valeur unique (couleur, taille…).
      const nonAccessory = attrs.filter((a) => a !== "accessories");
      expect(new Set(nonAccessory).size).toBe(nonAccessory.length);
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe("solveClues — cas dégénérés", () => {
  it("rejette un inventaire vide", () => {
    const result = solveClues([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toMatch(/trop petit/);
  });

  it("rejette un inventaire trop petit", () => {
    const result = solveClues(Array.from({ length: 5 }, () => obj()));
    expect(result.ok).toBe(false);
  });

  it("rejette des objets tous identiques : rien ne peut les distinguer", () => {
    const objects = Array.from({ length: 20 }, () => obj({ kind: "animal", color: "red" }));
    const result = solveClues(objects);
    expect(result.ok).toBe(false);
  });

  it("rejette quand aucun attribut n'est confirmé", () => {
    const objects = randomInventory(7, 25, 0.9).map((o) => ({ ...o, confident: [] }));
    const result = solveClues(objects);
    expect(result.ok).toBe(false);
  });

  it("refuse un puzzle qu'un objet aux attributs inconnus rendrait ambigu", () => {
    // Un « jumeau fantôme » : mêmes attributs que la solution, mais tous incertains.
    // Il ne matche rien avec certitude, pourtant il pourrait tout matcher — donc
    // aucun quadruplet ne doit être accepté.
    const solution = obj({ kind: "animal", color: "red", size: "small", accessories: ["hat"] });
    const ghost = obj({ kind: "animal", color: "red", size: "small", accessories: ["hat"], confident: [] });
    const filler = Array.from({ length: 18 }, (_, i) =>
      obj({
        kind: "person", color: COLORS[i % COLORS.length], size: SIZES[i % 3],
        action: ACTIONS[i % ACTIONS.length],
        bbox: { x: (i % 5) * 0.19, y: Math.floor(i / 5) * 0.24, w: 0.05, h: 0.05 },
      }));
    const result = solveClues([solution, ghost, ...filler]);
    if (result.ok) {
      // Si un puzzle passe malgré tout, le fantôme ne doit pas pouvoir le satisfaire.
      expect(conceivableMatches(result.puzzle.predicates, [solution, ghost, ...filler])).toHaveLength(1);
    }
  });

  it("est déterministe : même inventaire, même puzzle", () => {
    const a = solveClues(randomInventory(42, 25, 0.9));
    const b = solveClues(randomInventory(42, 25, 0.9));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("decoyHistogram", () => {
  it("compte les leurres par nombre d'indices satisfaits", () => {
    const preds: Predicate[] = [
      { attr: "kind", value: "animal" },
      { attr: "color", value: "red" },
      { attr: "size", value: "small" },
      { attr: "accessories", value: "hat" },
    ];
    const objects = [
      obj({ kind: "animal", color: "red", size: "small", accessories: ["hat"] }), // 4
      obj({ kind: "animal", color: "red", size: "small" }),                        // 3
      obj({ kind: "animal", color: "red", size: "large" }),                        // 2
      obj({ kind: "animal", color: "blue", size: "large" }),                       // 1
      obj({ kind: "vehicle", color: "blue", size: "large" }),                      // 0
    ];
    expect(decoyHistogram(preds, objects)).toEqual([1, 1, 1, 1, 1]);
  });

  it("ne crédite pas un attribut incertain", () => {
    const preds: Predicate[] = [{ attr: "color", value: "red" }];
    const objects = [obj({ color: "red", confident: [] })];
    expect(decoyHistogram(preds, objects)).toEqual([1, 0]);
  });
});
