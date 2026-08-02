/** Emplacements du pipeline. Tout ce qui vit sous .work/ est jetable et gitignoré. */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..");
export const WORK = join(ROOT, "tools", ".work");

export const DIRS = {
  scenes: join(WORK, "scenes"),
  inventories: join(WORK, "inventories"),
  candidates: join(WORK, "candidates"),
  /** Images figées à l'acceptation. Immuables : plus rien ne doit les réécrire. */
  accepted: join(WORK, "accepted"),
  /** Candidats déjà publiés, retirés de la file pour ne pas repartir deux fois. */
  published: join(WORK, "published"),
  rejected: join(WORK, "rejected"),
  spike: join(WORK, "spike"),
  /** Puzzles validés — versionnés, ce sont eux la source de vérité du jeu. */
  puzzles: join(ROOT, "content", "puzzles"),
  audits: join(ROOT, "content", "audits"),
  images: join(ROOT, "public", "img"),
};

export function ensureDirs(): void {
  for (const dir of Object.values(DIRS)) mkdirSync(dir, { recursive: true });
}

/** Analyseur d'arguments minimal : `--clé valeur` et `--drapeau`. */
export function parseArgs(argv: string[] = process.argv.slice(2)): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i++; } else { out[key] = true; }
  }
  return out;
}
