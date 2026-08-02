/** Textes d'interface FR/EN. Les indices, eux, sont traduits dans le JSON du puzzle. */

import type { Locale } from "./types";

export const UI = {
  fr: {
    tagline: "Un objet. Quatre indices. Une chance par jour.",
    clue: "Indice",
    lockedClue: "Se révèle à la prochaine erreur",
    attempts: "Essais",
    attemptsLeft: (n: number) => (n === 1 ? "1 essai restant" : `${n} essais restants`),
    instructions: "Clique sur l'objet qui satisfait tous les indices.",
    wrong: "Raté — un indice de plus.",
    lastChance: "Dernière chance : tous les indices sont là.",
    won: "Trouvé !",
    lost: "Perdu",
    wonIn: (n: number) => (n === 1 ? "Du premier coup." : `En ${n} essais.`),
    lostBody: "La solution était ici.",
    share: "Partager",
    copied: "Copié !",
    stats: "Statistiques",
    played: "Parties",
    winRate: "% réussite",
    streak: "Série",
    maxStreak: "Record",
    distribution: "Répartition",
    next: "Prochain puzzle",
    loading: "Chargement…",
    noPuzzle: "Aucun puzzle aujourd'hui",
    noPuzzleBody: "Reviens demain — ou lance `npm run fixture` en développement.",
    zoomHint: "Molette ou pincement pour zoomer, glisse pour te déplacer",
    close: "Fermer",
  },
  en: {
    tagline: "One object. Four clues. One shot a day.",
    clue: "Clue",
    lockedClue: "Unlocks on your next miss",
    attempts: "Attempts",
    attemptsLeft: (n: number) => (n === 1 ? "1 attempt left" : `${n} attempts left`),
    instructions: "Click the object that matches every clue.",
    wrong: "Miss — here's another clue.",
    lastChance: "Last chance: every clue is out.",
    won: "Found it!",
    lost: "Out of tries",
    wonIn: (n: number) => (n === 1 ? "First try." : `In ${n} attempts.`),
    lostBody: "The answer was here.",
    share: "Share",
    copied: "Copied!",
    stats: "Statistics",
    played: "Played",
    winRate: "Win %",
    streak: "Streak",
    maxStreak: "Best",
    distribution: "Distribution",
    next: "Next puzzle",
    loading: "Loading…",
    noPuzzle: "No puzzle today",
    noPuzzleBody: "Check back tomorrow — or run `npm run fixture` in development.",
    zoomHint: "Scroll or pinch to zoom, drag to pan",
    close: "Close",
  },
} as const;

export type Strings = (typeof UI)[Locale];

/** Langue déduite du navigateur, français par défaut. */
export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "fr";
  return navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}
