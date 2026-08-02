/**
 * Numérotation quotidienne des puzzles.
 *
 * Bascule à **minuit local**, comme Wordle : chacun découvre son puzzle au début
 * de sa propre journée, pas à une heure UTC arbitraire au milieu de la nuit.
 *
 * Conséquence assumée : à un instant donné, deux fuseaux extrêmes (UTC+14 et
 * UTC-11) ne jouent pas le même numéro. Le déploiement doit donc embarquer
 * jusqu'à J+1, et quelqu'un qui change le fuseau de sa machine peut voir le
 * puzzle du lendemain en avance. Wordle a exactement le même comportement ; ce
 * n'est pas un défaut à corriger, c'est le prix du minuit local.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Date du puzzle n° 1 (month est 0-indexé : 7 = août).
 *
 * **À figer avant le lancement, et à ne plus jamais toucher ensuite** : toute la
 * numérotation en découle, et la décaler renuméroterait tous les puzzles déjà
 * publiés et partagés. À changer une dernière fois pour la vraie date d'ouverture.
 */
export const EPOCH = { year: 2026, month: 7, day: 1 } as const;

/**
 * Indice de jour absolu à partir de composantes calendaires.
 *
 * On passe par Date.UTC alors qu'on manipule des dates *locales* : c'est
 * volontaire. Cela neutralise l'heure d'été — sans ça, la nuit du changement
 * d'heure dure 23 ou 25 h et un simple écart de millisecondes ferait sauter ou
 * répéter un numéro de puzzle.
 */
function dayIndex(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month, day) / MS_PER_DAY);
}

/** Numéro du puzzle correspondant à la journée *locale* de `now`. Le premier vaut 1. */
export function puzzleNumberFor(now: Date): number {
  const today = dayIndex(now.getFullYear(), now.getMonth(), now.getDate());
  return today - dayIndex(EPOCH.year, EPOCH.month, EPOCH.day) + 1;
}

/** Clé calendaire locale au format YYYY-MM-DD (jamais l'UTC : le joueur vit dans son fuseau). */
export function localDateKey(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Millisecondes restantes avant le prochain puzzle (minuit local). */
export function msUntilNextPuzzle(now: Date): number {
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return nextMidnight.getTime() - now.getTime();
}

/** Compte à rebours formaté `HH:MM:SS`. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}
