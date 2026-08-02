/**
 * Machine à états d'une partie. **Pure** : aucun accès au DOM, au stockage ni à
 * l'horloge. Tout entre par les arguments, tout sort par la valeur de retour —
 * c'est ce qui la rend exhaustivement testable.
 *
 * Déroulé (5 essais, révélation progressive) :
 *   essai 1 → 1 indice · essai 2 → 2 indices · essai 3 → 3 · essai 4 → 4
 *   essai 5 → 4 indices (dernière chance) · 5 erreurs → perdu
 */

import { CLUE_COUNT, MAX_ATTEMPTS, type BBox } from "./types";
import { hitsSolution } from "./solution";

export interface Point {
  x: number;
  y: number;
}

export interface Attempt {
  point: Point;
  correct: boolean;
}

export type GameStatus = "playing" | "won" | "lost";

export interface GameState {
  status: GameStatus;
  attempts: Attempt[];
}

export function initialState(): GameState {
  return { status: "playing", attempts: [] };
}

/**
 * Nombre d'indices visibles. Le premier est offert ; chaque erreur en dévoile un
 * de plus, jusqu'aux quatre. Une fois la partie finie, tout est visible.
 */
export function revealedClueCount(state: GameState): number {
  if (state.status !== "playing") return CLUE_COUNT;
  return Math.min(CLUE_COUNT, state.attempts.length + 1);
}

/** Essais encore disponibles. */
export function attemptsLeft(state: GameState): number {
  return Math.max(0, MAX_ATTEMPTS - state.attempts.length);
}

/**
 * Enregistre un clic. Renvoie un **nouvel** état ; l'ancien n'est jamais modifié.
 * Un clic sur une partie terminée est ignoré (l'UI peut donc rester naïve).
 */
export function registerClick(state: GameState, point: Point, solution: BBox): GameState {
  if (state.status !== "playing") return state;

  const correct = hitsSolution(point, solution);
  const attempts = [...state.attempts, { point, correct }];

  if (correct) return { status: "won", attempts };
  return { status: attempts.length >= MAX_ATTEMPTS ? "lost" : "playing", attempts };
}

/** Numéro de l'essai gagnant (1..MAX_ATTEMPTS), ou null si la partie n'est pas gagnée. */
export function winningAttempt(state: GameState): number | null {
  const i = state.attempts.findIndex((a) => a.correct);
  return i === -1 ? null : i + 1;
}

/** Combien d'indices il aura fallu pour trouver — la vraie mesure de performance ici. */
export function cluesUsed(state: GameState): number | null {
  const attempt = winningAttempt(state);
  return attempt === null ? null : Math.min(CLUE_COUNT, attempt);
}
