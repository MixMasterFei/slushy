/**
 * Étape 5 — publication.
 *
 * Transforme les candidats validés en artefacts versionnés : une image optimisée,
 * un JSON de jeu volontairement minimal, et un JSON d'audit qui reste hors du build.
 *
 * Le partage des rôles est délibéré :
 *   content/puzzles/<n>.json → part au client. Ni inventaire, ni leurres, ni
 *                              prédicats : la solution y est encodée (obfuscation
 *                              légère, cf. lib/solution.ts).
 *   content/audits/<n>.json  → ne quitte jamais le dépôt. Inventaire complet et
 *                              courbe de resserrement, pour la revue et le débogage.
 *
 *   npm run publish -- --start 2026-09-01
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { DIRS, ensureDirs, parseArgs } from "./paths";
import { renderClues } from "../lib/clue-text";
import { encodeSolution } from "../lib/solution";
import { EPOCH } from "../lib/puzzle";
import type { Puzzle, PuzzleAudit, SceneInventory, Predicate, BBox } from "../lib/types";

export interface Candidate {
  sceneId: string;
  theme: string;
  /** Chemin de l'image FIGÉE à l'acceptation (tools/.work/accepted/). */
  imagePath: string;
  /** Empreinte de cette image, revérifiée avant publication. */
  imageSha256: string;
  predicates: Predicate[];
  solutionId: string;
  solutionLabel: string;
  solutionBBox: BBox;
  narrowing: number[];
  decoyHistogram: number[];
  inventory: SceneInventory;
}

/** Numéro de puzzle correspondant à une date calendaire, aligné sur lib/puzzle. */
function puzzleNumberForDateKey(key: string): number {
  // Sans cette validation, `--start 2026/09/01` produisait un NaN qui traversait
  // toute la chaîne : fichiers littéralement nommés NaN.json, date « NaN-NaN-NaN »,
  // et boucle infinie dans nextFreeNumber (NaN++ reste NaN).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new Error(`--start attend une date au format YYYY-MM-DD, reçu « ${key} »`);
  }
  const [y, m, d] = key.split("-").map(Number);
  const day = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  const epoch = Math.floor(Date.UTC(EPOCH.year, EPOCH.month, EPOCH.day) / 86_400_000);
  const n = day - epoch + 1;
  if (!Number.isInteger(n)) throw new Error(`Date --start invalide : « ${key} »`);
  return n;
}

function dateKeyForPuzzleNumber(n: number): string {
  const epoch = Date.UTC(EPOCH.year, EPOCH.month, EPOCH.day);
  const at = new Date(epoch + (n - 1) * 86_400_000);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/** Premier numéro encore libre à partir de `from`. */
export function nextFreeNumber(from: number): number {
  // Garde-fou : `while (taken.has(n)) n++` ne terminerait jamais avec NaN, puisque
  // NaN + 1 vaut NaN et que Set.has(NaN) est vrai (SameValueZero).
  if (!Number.isInteger(from)) throw new Error(`Numéro de départ invalide : ${from}`);
  ensureDirs();
  const taken = new Set(
    readdirSync(DIRS.puzzles)
      .filter((f) => f.endsWith(".json"))
      .map((f) => Number(f.replace(".json", "")))
      .filter(Number.isInteger),
  );
  let n = from;
  while (taken.has(n)) n++;
  return n;
}

/** sceneId déjà publiés, lus depuis les audits — filet contre le double envoi. */
function publishedSceneIds(): Set<string> {
  ensureDirs();
  const ids = new Set<string>();
  for (const file of readdirSync(DIRS.audits).filter((f) => f.endsWith(".json"))) {
    try {
      const audit = JSON.parse(readFileSync(join(DIRS.audits, file), "utf8")) as { sceneId?: string };
      if (audit.sceneId) ids.add(audit.sceneId);
    } catch {
      // Audit illisible : on préfère republier que de bloquer la publication.
    }
  }
  return ids;
}

export async function publishCandidate(candidate: Candidate, puzzleNumber: number): Promise<Puzzle> {
  ensureDirs();

  const png = readFileSync(candidate.imagePath);

  // L'image doit être EXACTEMENT celle sur laquelle le solveur a calculé les
  // indices et la vérification adverse a statué. Sans ce contrôle, un fichier
  // remplacé entre-temps produirait un puzzle dont les indices et la bbox de
  // solution ne correspondent à rien de ce qu'on voit — sans la moindre erreur.
  if (candidate.imageSha256) {
    const actual = createHash("sha256").update(png).digest("hex");
    if (actual !== candidate.imageSha256) {
      throw new Error(
        `${candidate.sceneId} : l'image ne correspond plus à celle validée ` +
        `(attendu ${candidate.imageSha256.slice(0, 12)}, trouvé ${actual.slice(0, 12)}). Candidat écarté.`,
      );
    }
  }

  // Nom haché : deux images ne peuvent pas se marcher dessus, et le cache CDN est
  // invalidé automatiquement si le contenu change.
  const webp = await sharp(png).webp({ quality: 82 }).toBuffer();
  const { width = 0, height = 0 } = await sharp(webp).metadata();
  const hash = createHash("sha256").update(webp).digest("hex").slice(0, 12);
  const filename = `${hash}.webp`;
  writeFileSync(join(DIRS.images, filename), webp);

  const puzzle: Puzzle = {
    number: puzzleNumber,
    date: dateKeyForPuzzleNumber(puzzleNumber),
    image: { src: `/img/${filename}`, width, height },
    clues: renderClues(candidate.predicates),
    solution: {
      token: encodeSolution(
        { bbox: candidate.solutionBBox, label: candidate.solutionLabel },
        puzzleNumber,
      ),
    },
  };

  const audit: PuzzleAudit = {
    number: puzzleNumber,
    sceneId: candidate.sceneId,
    theme: candidate.theme,
    predicates: candidate.predicates,
    solutionId: candidate.solutionId,
    solutionLabel: candidate.solutionLabel,
    solutionBBox: candidate.solutionBBox,
    narrowing: candidate.narrowing,
    decoyHistogram: candidate.decoyHistogram,
    inventory: candidate.inventory,
  };

  writeFileSync(join(DIRS.puzzles, `${puzzleNumber}.json`), JSON.stringify(puzzle, null, 2));
  writeFileSync(join(DIRS.audits, `${puzzleNumber}.json`), JSON.stringify(audit, null, 2));
  return puzzle;
}

async function main() {
  const args = parseArgs();
  ensureDirs();

  const startKey = typeof args.start === "string" ? args.start : null;
  let next = nextFreeNumber(startKey ? puzzleNumberForDateKey(startKey) : 1);

  const candidateFiles = readdirSync(DIRS.candidates).filter((f) => f.endsWith(".json"));
  if (candidateFiles.length === 0) {
    console.log("Aucun candidat validé à publier. Lancer d'abord : npm run batch");
    return;
  }

  const alreadyPublished = publishedSceneIds();
  console.log(`${candidateFiles.length} candidat(s) en file, à partir du n° ${next}.`);

  for (const file of candidateFiles.sort()) {
    const path = join(DIRS.candidates, file);
    const candidate = JSON.parse(readFileSync(path, "utf8")) as Candidate;

    if (alreadyPublished.has(candidate.sceneId)) {
      console.log(`  · ${candidate.sceneId} déjà publié, ignoré`);
      renameSync(path, join(DIRS.published, file));
      continue;
    }
    if (!existsSync(candidate.imagePath)) {
      console.warn(`  ⚠ ${file} : image introuvable (${candidate.imagePath}), ignoré`);
      continue;
    }

    try {
      const puzzle = await publishCandidate(candidate, next);
      console.log(`  ✓ n° ${puzzle.number} (${puzzle.date}) — « ${candidate.solutionLabel} »`);
      // Le candidat est retiré de la file : sans ça, chaque exécution ultérieure
      // republierait tout le stock sous de nouveaux numéros, et les joueurs
      // recevraient deux fois le même puzzle à quelques jours d'intervalle.
      renameSync(path, join(DIRS.published, file));
      alreadyPublished.add(candidate.sceneId);
      next = nextFreeNumber(next + 1);
    } catch (error) {
      console.error(`  ✗ ${candidate.sceneId} : ${error instanceof Error ? error.message : error}`);
    }
  }
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
