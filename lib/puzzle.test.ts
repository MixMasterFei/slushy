import { describe, expect, it } from "vitest";
import { EPOCH, formatCountdown, localDateKey, msUntilNextPuzzle, puzzleNumberFor } from "./puzzle";

const noonOn = (offsetDays: number) =>
  new Date(EPOCH.year, EPOCH.month, EPOCH.day + offsetDays, 12, 0, 0);

describe("puzzleNumberFor", () => {
  it("le jour d'époque est le puzzle n° 1", () => {
    expect(puzzleNumberFor(noonOn(0))).toBe(1);
  });

  it("avance d'exactement 1 par jour calendaire, sur plus d'un an", () => {
    // Couvre les fins de mois, les mois de 31/30/28 jours, le passage d'année
    // et les deux bascules d'heure d'été.
    for (let i = 0; i < 500; i++) {
      expect(puzzleNumberFor(noonOn(i))).toBe(i + 1);
    }
  });

  it("ne change pas au cours d'une même journée locale, y compris aux extrémités", () => {
    const y = 2026, m = 10, d = 15;
    const justAfterMidnight = new Date(y, m, d, 0, 0, 1);
    const justBeforeMidnight = new Date(y, m, d, 23, 59, 59);
    expect(puzzleNumberFor(justAfterMidnight)).toBe(puzzleNumberFor(justBeforeMidnight));
  });

  it("résiste aux changements d'heure : une journée de 23 h ou 25 h vaut toujours un puzzle", () => {
    // Bascules européennes 2027 : 28 mars (23 h) et 31 octobre (25 h).
    for (const [year, month, day] of [[2027, 2, 28], [2027, 9, 31]] as const) {
      const veille = puzzleNumberFor(new Date(year, month, day - 1, 12, 0, 0));
      const jour = puzzleNumberFor(new Date(year, month, day, 12, 0, 0));
      const lendemain = puzzleNumberFor(new Date(year, month, day + 1, 12, 0, 0));
      expect(jour - veille).toBe(1);
      expect(lendemain - jour).toBe(1);
      // Et aucun saut à l'intérieur même de la journée perturbée.
      expect(puzzleNumberFor(new Date(year, month, day, 0, 30, 0))).toBe(jour);
      expect(puzzleNumberFor(new Date(year, month, day, 23, 30, 0))).toBe(jour);
    }
  });

  it("est négatif ou nul avant l'époque, sans exploser", () => {
    expect(puzzleNumberFor(noonOn(-1))).toBe(0);
    expect(puzzleNumberFor(noonOn(-10))).toBe(-9);
  });
});

describe("localDateKey", () => {
  it("formate en YYYY-MM-DD avec zéros de tête", () => {
    expect(localDateKey(new Date(2026, 0, 5, 10, 0, 0))).toBe("2026-01-05");
    expect(localDateKey(new Date(2026, 11, 31, 23, 0, 0))).toBe("2026-12-31");
  });

  it("suit le calendrier local et non l'UTC", () => {
    // 23 h locales : selon le fuseau, l'UTC peut déjà être au lendemain.
    // La clé doit rester celle de la journée que vit le joueur.
    const late = new Date(2026, 5, 10, 23, 30, 0);
    expect(localDateKey(late)).toBe("2026-06-10");
  });
});

describe("msUntilNextPuzzle", () => {
  it("est strictement positif et n'excède jamais 25 h", () => {
    for (let i = 0; i < 400; i++) {
      const at = new Date(2026, 8, 1 + i, (i * 7) % 24, (i * 13) % 60, 0);
      const ms = msUntilNextPuzzle(at);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(25 * 3600_000);
    }
  });

  it("tombe pile sur le changement de numéro de puzzle", () => {
    const at = new Date(2026, 8, 10, 17, 42, 13);
    const next = new Date(at.getTime() + msUntilNextPuzzle(at));
    expect(puzzleNumberFor(next)).toBe(puzzleNumberFor(at) + 1);
    const justBefore = new Date(next.getTime() - 1000);
    expect(puzzleNumberFor(justBefore)).toBe(puzzleNumberFor(at));
  });
});

describe("formatCountdown", () => {
  it("formate en HH:MM:SS", () => {
    expect(formatCountdown(0)).toBe("00:00:00");
    expect(formatCountdown(61_000)).toBe("00:01:01");
    expect(formatCountdown(3_661_000)).toBe("01:01:01");
    expect(formatCountdown(23 * 3600_000 + 59 * 60_000 + 59_000)).toBe("23:59:59");
  });

  it("ne produit pas de valeur négative", () => {
    expect(formatCountdown(-5000)).toBe("00:00:00");
  });
});
