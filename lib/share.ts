/**
 * Grille de partage — le moteur de croissance du format quotidien.
 *
 * Contrainte non négociable : **aucun spoiler**. Le texte dit combien d'essais il
 * a fallu, jamais ce qu'il fallait trouver ni où. Quelqu'un qui n'a pas encore
 * joué doit pouvoir le lire sans rien perdre.
 */

import { MAX_ATTEMPTS, type Locale } from "./types";
import { winningAttempt, type GameState } from "./game-state";

const WRONG = "🟥";
const FOUND = "🟩";
const UNUSED = "⬜";

export const SHARE_URL = "https://slushy.game";

/** Ligne d'emoji : les essais ratés, celui qui a payé, puis ceux qu'on n'a pas eu à jouer. */
export function shareGrid(state: GameState): string {
  const won = winningAttempt(state);
  const used = state.attempts.length;
  const cells: string[] = [];
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    if (won !== null && i === won) cells.push(FOUND);
    else if (i <= used) cells.push(WRONG);
    else cells.push(UNUSED);
  }
  return cells.join("");
}

/** Score affiché : « 3/5 », ou « X/5 » en cas d'échec (convention Wordle). */
export function shareScore(state: GameState): string {
  const won = winningAttempt(state);
  return `${won ?? "X"}/${MAX_ATTEMPTS}`;
}

export function shareText(
  puzzleNumber: number,
  state: GameState,
  locale: Locale = "fr",
  url: string = SHARE_URL,
): string {
  const header = `Slushy #${puzzleNumber} — ${shareScore(state)}`;
  const tagline = locale === "fr"
    ? (winningAttempt(state) === 1 ? "Trouvé du premier coup !" : "")
    : (winningAttempt(state) === 1 ? "First try!" : "");
  return [header, shareGrid(state), tagline, url].filter(Boolean).join("\n");
}
