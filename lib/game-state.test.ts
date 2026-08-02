import { describe, expect, it } from "vitest";
import {
  attemptsLeft, cluesUsed, initialState, registerClick, revealedClueCount, winningAttempt,
} from "./game-state";
import { shareGrid, shareScore, shareText } from "./share";
import { CLUE_COUNT, MAX_ATTEMPTS, type BBox } from "./types";

const SOLUTION: BBox = { x: 0.4, y: 0.4, w: 0.1, h: 0.1 };
const HIT = { x: 0.45, y: 0.45 };
const MISS = { x: 0.05, y: 0.9 };

/** Joue `n` clics ratés d'affilée. */
function missTimes(n: number) {
  let state = initialState();
  for (let i = 0; i < n; i++) state = registerClick(state, MISS, SOLUTION);
  return state;
}

describe("déroulé d'une partie", () => {
  it("commence avec un seul indice visible et tous les essais disponibles", () => {
    const state = initialState();
    expect(state.status).toBe("playing");
    expect(revealedClueCount(state)).toBe(1);
    expect(attemptsLeft(state)).toBe(MAX_ATTEMPTS);
  });

  it("chaque erreur dévoile un indice de plus, jusqu'aux quatre", () => {
    expect(revealedClueCount(missTimes(0))).toBe(1);
    expect(revealedClueCount(missTimes(1))).toBe(2);
    expect(revealedClueCount(missTimes(2))).toBe(3);
    expect(revealedClueCount(missTimes(3))).toBe(4);
    // Le 5e essai se joue avec les mêmes 4 indices : il n'y en a pas d'autres.
    expect(revealedClueCount(missTimes(4))).toBe(CLUE_COUNT);
  });

  it("gagne au premier coup", () => {
    const state = registerClick(initialState(), HIT, SOLUTION);
    expect(state.status).toBe("won");
    expect(winningAttempt(state)).toBe(1);
    expect(cluesUsed(state)).toBe(1);
  });

  it("gagne après quelques erreurs", () => {
    const state = registerClick(missTimes(2), HIT, SOLUTION);
    expect(state.status).toBe("won");
    expect(winningAttempt(state)).toBe(3);
    expect(cluesUsed(state)).toBe(3);
  });

  it("perd après cinq erreurs, et pas avant", () => {
    expect(missTimes(4).status).toBe("playing");
    const lost = missTimes(5);
    expect(lost.status).toBe("lost");
    expect(attemptsLeft(lost)).toBe(0);
    expect(winningAttempt(lost)).toBeNull();
    expect(cluesUsed(lost)).toBeNull();
  });

  it("révèle tous les indices une fois la partie terminée", () => {
    expect(revealedClueCount(missTimes(5))).toBe(CLUE_COUNT);
    expect(revealedClueCount(registerClick(initialState(), HIT, SOLUTION))).toBe(CLUE_COUNT);
  });

  it("ignore les clics après la fin de partie", () => {
    const won = registerClick(initialState(), HIT, SOLUTION);
    expect(registerClick(won, MISS, SOLUTION)).toBe(won);
    const lost = missTimes(5);
    expect(registerClick(lost, HIT, SOLUTION)).toBe(lost);
  });

  it("ne modifie jamais l'état précédent", () => {
    const before = initialState();
    const snapshot = JSON.stringify(before);
    registerClick(before, MISS, SOLUTION);
    registerClick(before, HIT, SOLUTION);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("mémorise où le joueur a cliqué, pour marquer la scène", () => {
    const state = registerClick(initialState(), MISS, SOLUTION);
    expect(state.attempts).toEqual([{ point: MISS, correct: false }]);
  });
});

describe("grille de partage", () => {
  it("marque les erreurs, la trouvaille, puis les essais non joués", () => {
    const state = registerClick(missTimes(2), HIT, SOLUTION);
    expect(shareGrid(state)).toBe("🟥🟥🟩⬜⬜");
    expect(shareScore(state)).toBe("3/5");
  });

  it("affiche cinq erreurs et X/5 en cas d'échec", () => {
    const lost = missTimes(5);
    expect(shareGrid(lost)).toBe("🟥🟥🟥🟥🟥");
    expect(shareScore(lost)).toBe("X/5");
  });

  it("compte toujours MAX_ATTEMPTS cases", () => {
    for (let misses = 0; misses <= MAX_ATTEMPTS; misses++) {
      expect([...shareGrid(missTimes(misses))].length).toBe(MAX_ATTEMPTS);
    }
  });

  it("ne divulgue jamais la solution", () => {
    const text = shareText(142, registerClick(missTimes(1), HIT, SOLUTION), "fr");
    expect(text).toContain("Slushy #142");
    expect(text).toContain("2/5");
    // Ni coordonnées, ni libellé de l'objet : le partage doit être lisible par
    // quelqu'un qui n'a pas encore joué.
    expect(text).not.toMatch(/0\.\d/);
    expect(text.toLowerCase()).not.toContain("solution");
  });

  it("salue la trouvaille du premier coup", () => {
    const first = registerClick(initialState(), HIT, SOLUTION);
    expect(shareText(1, first, "fr")).toContain("premier coup");
    expect(shareText(1, first, "en")).toContain("First try");
  });
});
