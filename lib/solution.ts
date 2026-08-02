/**
 * Encodage de la solution dans le JSON publié.
 *
 * ATTENTION — ceci est de l'**obfuscation, pas de la sécurité.** Sur un jeu
 * entièrement statique, le client doit pouvoir valider un clic hors ligne et
 * révéler la réponse en cas d'échec : la solution est donc nécessairement présente
 * dans ce qu'on télécharge. Quelqu'un qui lit le JS la retrouvera, et c'est
 * inévitable — Wordle expédiait de la même façon toute sa liste de mots.
 *
 * Le seul objectif est d'empêcher la triche triviale : ouvrir le JSON et y lire
 * `x: 0.42, y: 0.61` en clair. Ne pas confondre avec une garantie.
 *
 * Fonctionne à l'identique côté Node (pipeline) et navigateur (jeu) : uniquement
 * TextEncoder/TextDecoder et base64, disponibles des deux côtés.
 */

import type { BBox } from "./types";

const SALT = "slushy-v1";

export interface SolutionPayload {
  bbox: BBox;
  label: string;
}

/** Keystream déterministe dérivé du numéro de puzzle (xorshift32 amorcé). */
function keystream(length: number, puzzleNumber: number): Uint8Array {
  let state = (puzzleNumber * 2654435761) >>> 0;
  for (let i = 0; i < SALT.length; i++) {
    state = (state ^ SALT.charCodeAt(i)) >>> 0;
    state = Math.imul(state, 16777619) >>> 0;
  }
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    out[i] = state & 0xff;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeSolution(payload: SolutionPayload, puzzleNumber: number): string {
  // Coordonnées arrondies à 4 décimales : bien assez précis pour un clic, et
  // évite d'expédier des flottants à 17 chiffres.
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  const compact = {
    b: [round(payload.bbox.x), round(payload.bbox.y), round(payload.bbox.w), round(payload.bbox.h)],
    l: payload.label,
  };
  const data = new TextEncoder().encode(JSON.stringify(compact));
  const key = keystream(data.length, puzzleNumber);
  const xored = data.map((byte, i) => byte ^ key[i]);
  return bytesToBase64(xored);
}

export function decodeSolution(token: string, puzzleNumber: number): SolutionPayload {
  const xored = base64ToBytes(token);
  const key = keystream(xored.length, puzzleNumber);
  const data = xored.map((byte, i) => byte ^ key[i]);
  const compact = JSON.parse(new TextDecoder().decode(data)) as { b: number[]; l: string };
  const [x, y, w, h] = compact.b;
  return { bbox: { x, y, w, h }, label: compact.l };
}

/**
 * Un clic touche-t-il la solution ?
 *
 * La bbox est élargie d'une marge relative : sur mobile un doigt vise mal, et un
 * objet correctement identifié ne doit pas être refusé pour trois pixels. La marge
 * est proportionnelle à la taille de l'objet, avec un plancher absolu pour que les
 * très petits objets restent atteignables au pouce.
 */
export function hitsSolution(
  point: { x: number; y: number },
  bbox: BBox,
  { relativeMargin = 0.1, minMargin = 0.015 }: { relativeMargin?: number; minMargin?: number } = {},
): boolean {
  const mx = Math.max(bbox.w * relativeMargin, minMargin);
  const my = Math.max(bbox.h * relativeMargin, minMargin);
  return (
    point.x >= bbox.x - mx &&
    point.x <= bbox.x + bbox.w + mx &&
    point.y >= bbox.y - my &&
    point.y <= bbox.y + bbox.h + my
  );
}
