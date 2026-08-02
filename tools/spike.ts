/**
 * Phase 1a — le spike go/no-go.
 *
 * À lancer AVANT de construire quoi que ce soit d'autre. Tout le projet repose sur
 * une hypothèse non vérifiée : Gemini sait-il lire une scène dense de façon assez
 * stable et assez précise ? Ce script y répond avec des chiffres plutôt qu'avec
 * des espoirs, sur quelques scènes seulement.
 *
 * Deux mesures indépendantes, dans cet ordre d'importance :
 *
 *   (a) LOCALISATION — assez de régions exploitables, boîtes visuellement justes,
 *       pas deux sujets fondus dans une seule boîte. C'est le critère BLOQUANT :
 *       sans bounding box fiable, le joueur ne peut pas cliquer, et il n'y a pas
 *       de jeu. Le verdict se prononce à l'œil, sur les overlays produits ici.
 *
 *   (b) ATTRIBUTS — part d'attributs confirmés par les 3 passes. En dessous du
 *       seuil, presque rien n'est utilisable et le solveur ne trouvera jamais de
 *       quadruplet.
 *
 * Replis prévus si un seuil n'est pas atteint (aucun ne remet en cause le solveur,
 * le jeu ni le déploiement) :
 *   (a) → segmentation par vision classique, le style à aplats s'y prête bien.
 *   (b) → scènes moins denses, 10-15 objets explicitement imposés au générateur.
 *
 *   npm run spike -- --scenes 5
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { costTracker } from "./gemini";
import { generateScene } from "./1-generate-scene";
import { buildInventory, confidenceRate } from "./2-inventory";
import { solveClues } from "./3-solve-clues";
import { drawOverlay } from "./overlay";
import { DIRS, ensureDirs, parseArgs } from "./paths";
import { themeForIndex } from "./themes";
import { clueText } from "../lib/clue-text";

/** Seuils de décision, fixés avant de voir les résultats. */
const THRESHOLDS = {
  minRegionsPerScene: 25,
  minConfidenceRate: 0.6,
};

interface SceneReport {
  sceneId: string;
  theme: string;
  regions: number;
  confidence: number;
  solvable: boolean;
  solverNote: string;
  overlayPath: string;
}

/**
 * @param existingImage Scène déjà sur disque. Permet de mesurer la lecture d'image
 *   sans repasser par la génération — utile quand seul le modèle de vision est
 *   accessible, ou pour rejouer l'inventaire sur une scène donnée sans la repayer.
 */
async function runScene(index: number, existingImage?: string): Promise<SceneReport> {
  const theme = themeForIndex(index);

  let scene: { sceneId: string; theme: string; imagePath: string };
  if (existingImage) {
    const name = basename(existingImage).replace(/\.[^.]+$/, "");
    console.log(`\n[${index + 1}] « ${name} » — image fournie, génération ignorée`);
    scene = { sceneId: name, theme: "fourni", imagePath: existingImage };
  } else {
    console.log(`\n[${index + 1}] « ${theme.id} » — génération…`);
    scene = await generateScene(theme, index);
  }

  console.log(`     inventaire (localisation + 3 passes de description)…`);
  const inventory = await buildInventory(scene.sceneId, scene.theme, scene.imagePath);
  const confidence = confidenceRate(inventory);

  const solved = solveClues(inventory.objects);
  const solverNote = solved.ok
    ? `courbe ${solved.puzzle.narrowing.join(" → ")}, leurres ${solved.puzzle.decoyHistogram.join("/")}`
    : solved.failure.reason;

  const overlayPath = join(DIRS.spike, `${scene.sceneId}-overlay.png`);
  await drawOverlay(
    readFileSync(scene.imagePath),
    inventory.objects.map((o) => ({
      bbox: o.bbox,
      label: o.label,
      highlight: solved.ok && o.id === solved.puzzle.solution.id,
    })),
    overlayPath,
  );

  writeFileSync(
    join(DIRS.spike, `${scene.sceneId}-inventory.json`),
    JSON.stringify(inventory, null, 2),
  );

  console.log(`     ${inventory.objects.length} objets · ${(confidence * 100).toFixed(0)} % d'attributs certains`);
  console.log(`     solveur : ${solverNote}`);
  if (solved.ok) {
    solved.puzzle.predicates.forEach((p, i) => console.log(`        ${i + 1}. ${clueText(p, "fr")}`));
    console.log(`        → « ${solved.puzzle.solution.label} »`);
  }

  return {
    sceneId: scene.sceneId, theme: scene.theme,
    regions: inventory.objects.length, confidence,
    solvable: solved.ok, solverNote, overlayPath,
  };
}

async function main() {
  const args = parseArgs();
  const count = Number(args.scenes ?? 5);
  ensureDirs();
  costTracker.reset();

  console.log(`Spike go/no-go — ${count} scène(s).`);
  console.log(`Seuils : ≥ ${THRESHOLDS.minRegionsPerScene} régions/scène, ` +
    `≥ ${(THRESHOLDS.minConfidenceRate * 100).toFixed(0)} % d'attributs certains.\n`);

  const existingImage = typeof args.image === "string" ? args.image : undefined;
  const reports: SceneReport[] = [];
  for (let i = 0; i < count; i++) {
    try {
      reports.push(await runScene(i, existingImage));
    } catch (error) {
      console.error(`  ✗ scène ${i + 1} en échec : ${error instanceof Error ? error.message : error}`);
    }
  }

  if (reports.length === 0) {
    console.error("\nAucune scène n'a abouti — vérifier la clé API et l'accès aux modèles.");
    process.exit(1);
  }

  const avgRegions = reports.reduce((s, r) => s + r.regions, 0) / reports.length;
  const avgConfidence = reports.reduce((s, r) => s + r.confidence, 0) / reports.length;
  const solvable = reports.filter((r) => r.solvable).length;

  const passA = avgRegions >= THRESHOLDS.minRegionsPerScene;
  const passB = avgConfidence >= THRESHOLDS.minConfidenceRate;

  console.log(`\n${"─".repeat(64)}`);
  console.log("VERDICT");
  console.log(`${"─".repeat(64)}`);
  console.log(`(a) Localisation  : ${avgRegions.toFixed(1)} régions/scène en moyenne  ` +
    `${passA ? "✓" : "✗ sous le seuil"}`);
  console.log(`(b) Attributs     : ${(avgConfidence * 100).toFixed(0)} % certains  ` +
    `${passB ? "✓" : "✗ sous le seuil"}`);
  console.log(`    Puzzles       : ${solvable}/${reports.length} scènes exploitables par le solveur`);
  console.log(`    Coût          : ${costTracker.summary()}`);
  console.log(`\n⚠ Le critère (a) se tranche À L'ŒIL, pas au compteur. Ouvrir les overlays :`);
  console.log(`    ${DIRS.spike}`);
  console.log(`  Vérifier qu'aucune boîte n'englobe deux sujets et qu'aucune ne déborde`);
  console.log(`  largement sur le décor. Un bon compte de régions mal placées ne vaut rien.`);

  if (!passA) console.log(`\n→ Repli (a) : segmentation par vision classique (composantes connexes).`);
  if (!passB) console.log(`→ Repli (b) : scènes moins denses, 10-15 objets imposés au générateur.`);
  if (passA && passB) console.log(`\n→ GO : poursuivre avec l'approche scène dense.`);

  writeFileSync(
    join(DIRS.spike, "report.json"),
    JSON.stringify({ thresholds: THRESHOLDS, avgRegions, avgConfidence, solvable, reports }, null, 2),
  );
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
