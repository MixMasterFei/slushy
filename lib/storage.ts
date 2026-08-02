/**
 * Persistance locale : partie en cours, statistiques, série.
 *
 * Pas de compte, pas de base : le jeu est un export statique. Tout vit dans le
 * localStorage du navigateur, ce qui suffit au v1 et garde le coût d'exploitation
 * à zéro. Contrepartie assumée : la série ne suit pas d'un appareil à l'autre.
 *
 * Toutes les fonctions sont sûres côté serveur (Next.js pré-rend la page) et
 * tolèrent un stockage indisponible — navigation privée, quota plein, ou
 * utilisateur ayant désactivé le stockage. Dans ce cas le jeu reste jouable,
 * simplement sans mémoire.
 */

import type { Attempt, GameState, GameStatus } from "./game-state";
import { MAX_ATTEMPTS } from "./types";

const GAME_KEY = "slushy:game";
const STATS_KEY = "slushy:stats";

export interface Stats {
  played: number;
  wins: number;
  currentStreak: number;
  maxStreak: number;
  /** Dernier puzzle terminé — sert à savoir si la série continue ou se casse. */
  lastCompletedNumber: number | null;
  /** distribution[i] = parties gagnées à l'essai i+1. */
  distribution: number[];
}

export const EMPTY_STATS: Stats = {
  played: 0, wins: 0, currentStreak: 0, maxStreak: 0,
  lastCompletedNumber: null,
  distribution: new Array(MAX_ATTEMPTS).fill(0),
};

function read<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // JSON corrompu ou stockage inaccessible : on repart proprement
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota dépassé ou stockage refusé : le jeu continue sans mémoire.
  }
}

// ---------------------------------------------------------------------------
// Partie en cours
// ---------------------------------------------------------------------------

interface StoredGame {
  number: number;
  status: GameStatus;
  attempts: Attempt[];
}

/**
 * Reprend la partie du jour. Une partie enregistrée pour un autre numéro est
 * ignorée : c'est ce qui empêche de retrouver ses essais d'hier au réveil.
 */
export function loadGame(puzzleNumber: number): GameState | null {
  const stored = read<StoredGame>(GAME_KEY);
  if (!stored || stored.number !== puzzleNumber) return null;
  if (!Array.isArray(stored.attempts)) return null;
  return { status: stored.status, attempts: stored.attempts };
}

export function saveGame(puzzleNumber: number, state: GameState): void {
  write(GAME_KEY, { number: puzzleNumber, status: state.status, attempts: state.attempts });
}

// ---------------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------------

export function loadStats(): Stats {
  const stored = read<Stats>(STATS_KEY);
  if (!stored) return { ...EMPTY_STATS, distribution: [...EMPTY_STATS.distribution] };
  // Un stockage écrit par une version antérieure peut manquer de champs.
  return {
    ...EMPTY_STATS,
    ...stored,
    distribution: Array.isArray(stored.distribution)
      ? [...stored.distribution, ...new Array(MAX_ATTEMPTS).fill(0)].slice(0, MAX_ATTEMPTS)
      : [...EMPTY_STATS.distribution],
  };
}

/**
 * Enregistre une partie terminée. **Idempotent** : rejouer le même numéro ne
 * gonfle pas les compteurs, ce qui protège d'un double appel au montage du
 * composant ou d'un rafraîchissement de page.
 */
export function recordResult(
  puzzleNumber: number,
  state: GameState,
  previous: Stats = loadStats(),
): Stats {
  if (state.status === "playing") return previous;
  if (previous.lastCompletedNumber === puzzleNumber) return previous;

  const won = state.status === "won";
  const consecutive = previous.lastCompletedNumber === puzzleNumber - 1;
  const currentStreak = won ? (consecutive ? previous.currentStreak + 1 : 1) : 0;

  const distribution = [...previous.distribution];
  if (won) {
    const attempt = state.attempts.findIndex((a) => a.correct) + 1;
    if (attempt >= 1 && attempt <= MAX_ATTEMPTS) distribution[attempt - 1]++;
  }

  const stats: Stats = {
    played: previous.played + 1,
    wins: previous.wins + (won ? 1 : 0),
    currentStreak,
    maxStreak: Math.max(previous.maxStreak, currentStreak),
    lastCompletedNumber: puzzleNumber,
    distribution,
  };
  write(STATS_KEY, stats);
  return stats;
}

export function winRate(stats: Stats): number {
  return stats.played === 0 ? 0 : Math.round((stats.wins / stats.played) * 100);
}
