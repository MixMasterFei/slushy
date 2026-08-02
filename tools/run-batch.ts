/**
 * Orchestration d'un lot : génère, inventorie, résout et vérifie en boucle
 * jusqu'à obtenir N candidats validés.
 *
 * Le rejet est le régime NORMAL de ce pipeline, pas une anomalie : une scène dont
 * le solveur ne tire aucun quadruplet propre, ou qui échoue à la vérification
 * adverse, est jetée sans état d'âme. Mieux vaut brûler quelques dizaines de
 * centimes que publier un puzzle ambigu à la planète entière.
 *
 * Règle d'exploitation : garder toujours ~30 puzzles validés d'avance. Un jeu
 * quotidien qui saute un jour est mort, et une panne d'API ne doit jamais pouvoir
 * interrompre la cadence.
 *
 *   npm run batch -- --count 10 [--concurrency 3] [--start-index 0]
 */

import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { costTracker } from "./gemini";
import { generateScene } from "./1-generate-scene";
import { buildInventory, confidenceRate } from "./2-inventory";
import { solveClues } from "./3-solve-clues";
import { verifyPuzzle } from "./4-verify";
import type { Candidate } from "./5-publish";
import { DIRS, ensureDirs, parseArgs } from "./paths";
import { themeForIndex } from "./themes";
import { clueText } from "../lib/clue-text";

type Stage = "generate" | "inventory" | "solve" | "verify";

interface Outcome {
  index: number;
  accepted: boolean;
  stage?: Stage;
  detail: string;
}

/** Écarte la scène en la conservant : elle documente ce que le générateur rate. */
function discard(imagePath: string, sceneId: string): void {
  try {
    renameSync(imagePath, join(DIRS.rejected, `${sceneId}.png`));
  } catch {
    // Fichier déjà déplacé ou absent : rien à sauver, rien à signaler.
  }
}

async function attempt(index: number, runId: string): Promise<Outcome> {
  const theme = themeForIndex(index);

  let scene;
  try {
    scene = await generateScene(theme, index, runId);
  } catch (error) {
    return { index, accepted: false, stage: "generate", detail: String(error) };
  }

  let inventory;
  try {
    inventory = await buildInventory(scene.sceneId, scene.theme, scene.imagePath);
  } catch (error) {
    // Cette branche oubliait de nettoyer, contrairement aux suivantes : une image
    // jamais inventoriée restait alors sous un chemin que d'autres pouvaient lire.
    discard(scene.imagePath, scene.sceneId);
    return { index, accepted: false, stage: "inventory", detail: String(error) };
  }

  const solved = solveClues(inventory.objects);
  if (!solved.ok) {
    discard(scene.imagePath, scene.sceneId);
    return {
      index, accepted: false, stage: "solve",
      detail: `${inventory.objects.length} objets, ${(confidenceRate(inventory) * 100).toFixed(0)} % certains — ${solved.failure.reason}`,
    };
  }

  let verdict;
  try {
    verdict = await verifyPuzzle(scene.imagePath, solved.puzzle.predicates, solved.puzzle.solution.bbox);
  } catch (error) {
    // Sans ce catch, une panne API sur la vérification remontait jusqu'à
    // Promise.all et tuait le lot entier, gâchant toutes les scènes déjà payées.
    discard(scene.imagePath, scene.sceneId);
    return { index, accepted: false, stage: "verify", detail: `erreur de vérification — ${String(error)}` };
  }
  if (!verdict.passed) {
    discard(scene.imagePath, scene.sceneId);
    return { index, accepted: false, stage: "verify", detail: verdict.reason };
  }

  // --- Gel de l'image ------------------------------------------------------
  // À partir d'ici l'image est validée : elle est copiée dans un emplacement
  // immuable et son empreinte est enregistrée. La publication revérifiera cette
  // empreinte, ce qui rend structurellement impossible qu'un candidat parte avec
  // une image autre que celle sur laquelle le solveur et la vérification ont
  // travaillé — le pire mode d'échec possible, car totalement silencieux.
  const bytes = readFileSync(scene.imagePath);
  const imageSha256 = createHash("sha256").update(bytes).digest("hex");
  const frozenPath = join(DIRS.accepted, `${scene.sceneId}-${imageSha256.slice(0, 12)}.png`);
  copyFileSync(scene.imagePath, frozenPath);
  rmSync(scene.imagePath, { force: true });

  const candidate: Candidate = {
    sceneId: scene.sceneId,
    theme: scene.theme,
    imagePath: frozenPath,
    imageSha256,
    predicates: solved.puzzle.predicates,
    solutionId: solved.puzzle.solution.id,
    solutionLabel: solved.puzzle.solution.label,
    solutionBBox: solved.puzzle.solution.bbox,
    narrowing: solved.puzzle.narrowing,
    decoyHistogram: solved.puzzle.decoyHistogram,
    inventory,
  };
  writeFileSync(join(DIRS.candidates, `${scene.sceneId}.json`), JSON.stringify(candidate, null, 2));

  const clues = solved.puzzle.predicates.map((p) => clueText(p, "fr")).join(" · ");
  return {
    index, accepted: true,
    detail: `« ${solved.puzzle.solution.label} » — ${clues} [${solved.puzzle.narrowing.join("→")}]`,
  };
}

async function main() {
  const args = parseArgs();
  const target = Number(args.count ?? 10);
  const concurrency = Number(args.concurrency ?? 3);
  const startIndex = Number(args["start-index"] ?? 0);
  // Marge de rebut : on ignore le taux réel avant le premier lot, donc on plafonne
  // large sans laisser la boucle s'emballer.
  const maxAttempts = Number(args["max-attempts"] ?? target * 4);

  ensureDirs();
  costTracker.reset();

  // Jeton propre à ce lot, intégré aux sceneId. Sans lui, relancer `npm run batch`
  // sans --start-index rejouerait exactement les mêmes identifiants et écraserait
  // les scènes du lot précédent — rendant impossible le stock d'avance que ce
  // pipeline est justement censé constituer.
  const runId = Date.now().toString(36).slice(-6);

  console.log(`Lot ${runId} : ${target} puzzle(s) validé(s) visé(s), ${maxAttempts} tentatives au plus, ` +
    `${concurrency} en parallèle.\n`);

  const accepted: Outcome[] = [];
  const rejected: Outcome[] = [];
  let nextIndex = startIndex;
  let launched = 0;

  const worker = async () => {
    while (accepted.length < target && launched < maxAttempts) {
      const index = nextIndex++;
      launched++;
      const outcome = await attempt(index, runId);
      if (outcome.accepted) {
        accepted.push(outcome);
        console.log(`✓ [${accepted.length}/${target}] ${outcome.detail}`);
      } else {
        rejected.push(outcome);
        console.log(`✗ rejeté en « ${outcome.stage} » : ${outcome.detail.slice(0, 160)}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, maxAttempts) }, worker));

  const byStage = rejected.reduce<Record<string, number>>((acc, r) => {
    acc[r.stage ?? "?"] = (acc[r.stage ?? "?"] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\n${"─".repeat(64)}`);
  console.log(`${accepted.length} validé(s) sur ${launched} tentative(s)` +
    ` — taux d'acceptation ${((accepted.length / Math.max(1, launched)) * 100).toFixed(0)} %`);
  if (rejected.length) {
    console.log(`Rejets par étape : ${Object.entries(byStage).map(([s, n]) => `${s} ×${n}`).join(", ")}`);
  }
  console.log(`Coût : ${costTracker.summary()}`);

  if (accepted.length < target) {
    console.log(`\n⚠ Objectif non atteint (${accepted.length}/${target}). Relancer, ou revoir le`);
    console.log(`  prompt de scène si les rejets se concentrent sur « solve ».`);
  }
  console.log(`\nÉtape suivante : revue humaine des candidats, puis npm run publish`);
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
