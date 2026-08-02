/**
 * Prépare le build statique — et c'est ici que se joue l'anti-spoiler.
 *
 * `content/puzzles/` contient tout le stock d'avance (idéalement 30+ puzzles).
 * Rien de tout cela ne doit partir en production : sur un site statique, un fichier
 * présent est un fichier téléchargeable, et des numéros séquentiels se devinent en
 * trois secondes.
 *
 * On ne copie donc vers `public/puzzles/` que ce qui est légitimement jouable, et
 * le déploiement est reconstruit chaque jour. Le reste n'existe tout simplement
 * pas sur le CDN.
 *
 * Pourquoi J+1 et pas J : la bascule est à minuit LOCAL. À un instant donné,
 * quelqu'un en UTC+14 est déjà à la journée suivante par rapport à UTC. Ne
 * publier que J priverait de puzzle toute une frange du globe pendant des heures.
 */

import { copyFileSync, existsSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DIRS, ROOT } from "./paths";
import { puzzleNumberFor } from "../lib/puzzle";

const PUBLIC_PUZZLES = join(ROOT, "public", "puzzles");

export function prepareBuild(now: Date = new Date()): { published: number[]; withheld: number } {
  // Le fuseau de la machine de build ne doit pas décider pour la planète : on
  // prend la borne haute mondiale (UTC+14) en publiant jusqu'à J+1.
  const maxNumber = puzzleNumberFor(now) + 1;

  rmSync(PUBLIC_PUZZLES, { recursive: true, force: true });
  mkdirSync(PUBLIC_PUZZLES, { recursive: true });

  if (!existsSync(DIRS.puzzles)) return { published: [], withheld: 0 };

  const all = readdirSync(DIRS.puzzles)
    .filter((f) => f.endsWith(".json"))
    .map((f) => Number(f.replace(".json", "")))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const published: number[] = [];
  for (const n of all) {
    if (n > maxNumber) continue;
    copyFileSync(join(DIRS.puzzles, `${n}.json`), join(PUBLIC_PUZZLES, `${n}.json`));
    published.push(n);
  }

  return { published, withheld: all.length - published.length };
}

const { published, withheld } = prepareBuild();
console.log(
  `Build : ${published.length} puzzle(s) publié(s)` +
  (published.length ? ` (n° ${published[0]} à ${published[published.length - 1]})` : "") +
  `, ${withheld} gardé(s) hors du déploiement.`,
);
if (published.length === 0) {
  console.warn("⚠ Aucun puzzle jouable. Lancer `npm run fixture` ou `npm run batch` puis `npm run publish`.");
}
