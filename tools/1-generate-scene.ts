/**
 * Étape 1 — génération de la scène.
 *
 * Produit une image et rien d'autre : aucun indice n'est décidé ici. Le contenu
 * réel de l'image sera *découvert* à l'étape 2, jamais supposé. C'est tout le
 * principe du pipeline — on ne fabrique pas une image à partir d'indices, on
 * calcule des indices à partir de ce que l'image contient vraiment.
 *
 *   npm run scene -- --theme flea-market --variation 0
 *   npm run scene                      (thème choisi automatiquement)
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { costTracker, generateImage } from "./gemini";
import { DIRS, ensureDirs, parseArgs } from "./paths";
import { scenePrompt, themeById, themeForIndex, type Theme } from "./themes";

export interface GeneratedScene {
  sceneId: string;
  theme: string;
  imagePath: string;
  width: number;
  height: number;
}

/**
 * @param runId Jeton propre à une exécution de lot. Sans lui, deux lots lancés
 *   avec les mêmes index produiraient les mêmes `sceneId` et s'écraseraient
 *   mutuellement — un candidat validé pouvant alors se retrouver associé à une
 *   image totalement différente. Le passer rend toute collision impossible.
 */
export async function generateScene(
  theme: Theme,
  variation: number,
  runId?: string,
): Promise<GeneratedScene> {
  ensureDirs();
  const suffix = runId ? `-${runId}` : "";
  const sceneId = `${theme.id}-${String(variation).padStart(3, "0")}${suffix}`;
  const imagePath = join(DIRS.scenes, `${sceneId}.png`);

  const jpeg = await generateImage(scenePrompt(theme, variation), {
    aspectRatio: "16:9",
    imageSize: "2K",
  });

  // Transcodage unique en PNG. L'API ne rend que du JPEG ; garder ce JPEG comme
  // source des crops leur infligerait une seconde compression, précisément là où
  // la passe de description doit lire des détails fins — un chapeau, des lunettes.
  // La qualité perdue au premier encodage l'est de toute façon ; on évite juste
  // d'en perdre une seconde fois. Le surcoût est du disque dans .work/, ignoré par git.
  const png = await sharp(jpeg).png().toBuffer();
  writeFileSync(imagePath, png);

  const { width = 0, height = 0 } = await sharp(png).metadata();
  return { sceneId, theme: theme.id, imagePath, width, height };
}

async function main() {
  const args = parseArgs();
  const variation = Number(args.variation ?? 0);
  const theme = typeof args.theme === "string" ? themeById(args.theme) : themeForIndex(variation);

  console.log(`Génération « ${theme.id} » (variation ${variation})…`);
  const scene = await generateScene(theme, variation);
  console.log(`  ✓ ${scene.imagePath} — ${scene.width}×${scene.height}`);
  console.log(`  ${costTracker.summary()}`);
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
