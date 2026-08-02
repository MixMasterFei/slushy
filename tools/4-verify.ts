/**
 * Étape 4 — vérification adverse.
 *
 * Le solveur a prouvé l'unicité **sur l'inventaire**. Reste à savoir si
 * l'inventaire décrit fidèlement l'image : si l'étape 2 a mal lu un objet, le
 * puzzle est cohérent avec ses propres données mais faux pour le joueur.
 *
 * On repart donc de zéro. Un contexte vierge reçoit l'image nue et les 4 indices,
 * sans jamais savoir quelle est la réponse attendue, et doit désigner tout ce qui
 * colle. Le puzzle n'est retenu que s'il ne trouve qu'un seul objet, et que c'est
 * le bon.
 *
 * Limite connue et assumée : le vérificateur appartient à la même famille de
 * modèles que l'inventaire, donc leurs erreurs sont corrélées — une hallucination
 * partagée passerait deux fois. Brancher un second fournisseur ici (variable
 * ANTHROPIC_API_KEY) est la parade, à faire avant l'ouverture au public.
 */

import { readFileSync } from "node:fs";
import { askJSON } from "./gemini";
import {
  bboxFromGemini, iou, type BBox, type Locale, type Predicate,
} from "../lib/types";
import { clueText } from "../lib/clue-text";

/** Recouvrement minimal entre l'objet désigné et la solution pour parler du même sujet. */
const MIN_IOU = 0.5;
const PASSES = 2;

const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          box_2d: {
            type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4,
            description: "[ymin, xmin, ymax, xmax] mis à l'échelle 0-1000",
          },
        },
        required: ["label", "box_2d"],
      },
    },
  },
  required: ["matches"],
};

function verifyPrompt(predicates: readonly Predicate[], locale: Locale): string {
  const list = predicates.map((p, i) => `${i + 1}. ${clueText(p, locale)}`).join("\n");
  return `Voici une illustration et quatre critères.

${list}

Trouve TOUS les sujets de l'image qui satisfont les QUATRE critères à la fois.
Un sujet qui n'en satisfait que trois ne compte pas.

Sois exhaustif : s'il y en a plusieurs, liste-les tous. S'il n'y en a aucun,
renvoie une liste vide. N'invente rien et ne suppose pas qu'il doit y avoir
exactement une réponse.`;
}

export interface VerificationResult {
  passed: boolean;
  reason: string;
  /** Nombre d'objets désignés à chaque passe — révélateur quand ça échoue. */
  matchCounts: number[];
}

async function verifyOnce(
  image: Buffer,
  predicates: readonly Predicate[],
  solution: BBox,
): Promise<{ ok: boolean; count: number; reason: string }> {
  const result = await askJSON<{ matches: Array<{ label: string; box_2d: number[] }> }>({
    prompt: verifyPrompt(predicates, "fr"),
    image,
    schema: VERIFY_SCHEMA,
    temperature: 0,
  });

  const boxes: BBox[] = [];
  for (const m of result.matches ?? []) {
    try { boxes.push(bboxFromGemini(m.box_2d)); } catch { /* boîte inexploitable */ }
  }

  if (boxes.length === 0) {
    return { ok: false, count: 0, reason: "le vérificateur ne trouve aucun objet conforme" };
  }
  if (boxes.length > 1) {
    return {
      ok: false, count: boxes.length,
      reason: `${boxes.length} objets conformes selon le vérificateur : le puzzle est ambigu`,
    };
  }
  const overlap = iou(boxes[0], solution);
  if (overlap < MIN_IOU) {
    return {
      ok: false, count: 1,
      reason: `objet désigné différent de la solution (IoU ${overlap.toFixed(2)} < ${MIN_IOU})`,
    };
  }
  return { ok: true, count: 1, reason: "conforme" };
}

export async function verifyPuzzle(
  imagePath: string,
  predicates: readonly Predicate[],
  solution: BBox,
): Promise<VerificationResult> {
  const image = readFileSync(imagePath);
  const matchCounts: number[] = [];

  for (let pass = 0; pass < PASSES; pass++) {
    const result = await verifyOnce(image, predicates, solution);
    matchCounts.push(result.count);
    // Une seule passe qui doute suffit à écarter : mieux vaut jeter un bon puzzle
    // que d'en publier un injouable pour la planète entière.
    if (!result.ok) {
      return { passed: false, reason: `passe ${pass + 1} — ${result.reason}`, matchCounts };
    }
  }

  return { passed: true, reason: `${PASSES} passes concordantes`, matchCounts };
}
