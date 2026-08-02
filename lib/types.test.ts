import { describe, expect, it } from "vitest";
import { bboxFromGemini, bboxCenter, iou, zoneOf, type BBox } from "./types";
import { decodeSolution, encodeSolution, hitsSolution } from "./solution";

describe("bboxFromGemini", () => {
  it("convertit [ymin, xmin, ymax, xmax] en 0-1000 vers {x,y,w,h} en fractions", () => {
    // L'ordre des composantes est le piège classique de cette API : y d'abord.
    expect(bboxFromGemini([100, 200, 300, 600])).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.2 });
  });

  it("gère les coins pleine image", () => {
    expect(bboxFromGemini([0, 0, 1000, 1000])).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("redresse une boîte dont min et max sont inversés au lieu de produire une taille négative", () => {
    const b = bboxFromGemini([300, 600, 100, 200]);
    expect(b.w).toBeGreaterThan(0);
    expect(b.h).toBeGreaterThan(0);
    expect(b).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.2 });
  });

  it("borne les valeurs qui débordent de l'image", () => {
    const b = bboxFromGemini([-50, -100, 1200, 1100]);
    expect(b).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("refuse un tableau de mauvaise longueur", () => {
    expect(() => bboxFromGemini([1, 2, 3])).toThrow(/longueur 4/);
  });
});

describe("iou", () => {
  it("vaut 1 pour deux boîtes identiques", () => {
    const b: BBox = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    expect(iou(b, b)).toBeCloseTo(1);
  });

  it("vaut 0 pour deux boîtes disjointes", () => {
    expect(iou({ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 })).toBe(0);
  });

  it("vaut 1/3 pour un recouvrement de moitié", () => {
    const a: BBox = { x: 0, y: 0, w: 0.2, h: 0.1 };
    const b: BBox = { x: 0.1, y: 0, w: 0.2, h: 0.1 };
    expect(iou(a, b)).toBeCloseTo(1 / 3);
  });

  it("est symétrique", () => {
    const a: BBox = { x: 0.1, y: 0.2, w: 0.3, h: 0.15 };
    const b: BBox = { x: 0.2, y: 0.25, w: 0.3, h: 0.2 };
    expect(iou(a, b)).toBeCloseTo(iou(b, a));
  });
});

describe("zoneOf", () => {
  it("découpe la scène en grille 3×3 selon le centre de la boîte", () => {
    expect(zoneOf({ x: 0.0, y: 0.0, w: 0.1, h: 0.1 })).toEqual({ zoneX: "left", zoneY: "top" });
    expect(zoneOf({ x: 0.45, y: 0.45, w: 0.1, h: 0.1 })).toEqual({ zoneX: "center", zoneY: "middle" });
    expect(zoneOf({ x: 0.85, y: 0.85, w: 0.1, h: 0.1 })).toEqual({ zoneX: "right", zoneY: "bottom" });
  });

  it("classe selon le centre, pas le coin haut-gauche", () => {
    // Boîte large partant à gauche mais centrée à droite.
    const wide: BBox = { x: 0.3, y: 0.1, w: 0.6, h: 0.1 };
    expect(bboxCenter(wide).cx).toBeCloseTo(0.6);
    expect(zoneOf(wide).zoneX).toBe("center");
  });
});

describe("encodage de la solution", () => {
  const payload = { bbox: { x: 0.4231, y: 0.6187, w: 0.0812, h: 0.1044 }, label: "le chat à lunettes" };

  it("fait un aller-retour fidèle", () => {
    const token = encodeSolution(payload, 142);
    expect(decodeSolution(token, 142)).toEqual(payload);
  });

  it("supporte les accents et caractères non-ASCII", () => {
    const accented = { bbox: payload.bbox, label: "le hérisson à écharpe rayée — n°3" };
    expect(decodeSolution(encodeSolution(accented, 7), 7)).toEqual(accented);
  });

  it("ne laisse pas les coordonnées lisibles en clair", () => {
    const token = encodeSolution(payload, 142);
    expect(token).not.toContain("0.42");
    expect(token).not.toContain("chat");
    expect(token).not.toContain("bbox");
  });

  it("produit un jeton différent selon le numéro de puzzle", () => {
    expect(encodeSolution(payload, 1)).not.toBe(encodeSolution(payload, 2));
  });

  it("ne se décode pas avec le mauvais numéro de puzzle", () => {
    const token = encodeSolution(payload, 142);
    // Le mauvais keystream produit des octets incohérents : JSON.parse doit échouer
    // plutôt que renvoyer discrètement une solution fausse.
    expect(() => decodeSolution(token, 143)).toThrow();
  });
});

describe("hitsSolution", () => {
  const bbox: BBox = { x: 0.4, y: 0.4, w: 0.1, h: 0.1 };

  it("accepte un clic au centre", () => {
    expect(hitsSolution({ x: 0.45, y: 0.45 }, bbox)).toBe(true);
  });

  it("accepte un clic sur le bord", () => {
    expect(hitsSolution({ x: 0.4, y: 0.4 }, bbox)).toBe(true);
    expect(hitsSolution({ x: 0.5, y: 0.5 }, bbox)).toBe(true);
  });

  it("tolère un léger débordement — un doigt vise mal sur mobile", () => {
    expect(hitsSolution({ x: 0.505, y: 0.45 }, bbox)).toBe(true);
  });

  it("refuse un clic franchement à côté", () => {
    expect(hitsSolution({ x: 0.05, y: 0.9 }, bbox)).toBe(false);
    expect(hitsSolution({ x: 0.7, y: 0.45 }, bbox)).toBe(false);
  });

  it("garde un objet minuscule atteignable au pouce grâce à la marge plancher", () => {
    const tiny: BBox = { x: 0.5, y: 0.5, w: 0.004, h: 0.004 };
    // Sans plancher, 10 % de 0,004 serait une marge de 0,0004 — inatteignable.
    expect(hitsSolution({ x: 0.512, y: 0.512 }, tiny)).toBe(true);
    expect(hitsSolution({ x: 0.6, y: 0.6 }, tiny)).toBe(false);
  });
});
