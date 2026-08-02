/**
 * Adaptateur Gemini — le seul endroit du projet qui connaisse le SDK.
 *
 * Tout le reste du pipeline appelle `generateImage` / `askJSON`. Si l'API change,
 * ou si l'on veut basculer la génération d'images vers un autre fournisseur, il n'y
 * a que ce fichier à toucher.
 *
 * Ce module est exclusivement hors ligne (scripts tools/). La clé n'est jamais lue
 * par du code client : @google/genai est en devDependency, et rien ici n'est
 * importé depuis app/ ou components/.
 */

import { GoogleGenAI } from "@google/genai";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

export const IMAGE_MODEL = "gemini-3.1-flash-image";
export const VISION_MODEL = "gemini-3.6-flash";

/** Tarifs publics (août 2026), en dollars. Sert au suivi de coût du lot. */
const PRICING = {
  imagePerCall: { "1K": 0.067, "2K": 0.101, "4K": 0.151 } as Record<string, number>,
  visionInputPerMillion: 1.5,
  visionOutputPerMillion: 7.5,
};

let client: GoogleGenAI | null = null;

function ai(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new FatalApiError(
        "GEMINI_API_KEY absente. Copier .env.example vers .env.local et y mettre la clé.",
      );
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

// ---------------------------------------------------------------------------
// Suivi de coût
// ---------------------------------------------------------------------------

export const costTracker = {
  images: 0,
  visionCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  dollars: 0,
  reset() {
    this.images = 0; this.visionCalls = 0;
    this.inputTokens = 0; this.outputTokens = 0; this.dollars = 0;
  },
  summary(): string {
    return `${this.images} image(s) + ${this.visionCalls} appel(s) vision ` +
      `(${this.inputTokens} in / ${this.outputTokens} out tokens) ≈ $${this.dollars.toFixed(3)}`;
  },
};

// ---------------------------------------------------------------------------
// Robustesse réseau
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Erreur qu'il est inutile de réessayer : clé absente ou invalide, permission
 * refusée, requête malformée. Réessayer ne ferait que multiplier l'attente.
 */
export class FatalApiError extends Error {}

/**
 * Une erreur est-elle définitive ?
 *
 * Surtout **ne pas classer sur le texte du message**. La version précédente
 * testait /…|invalid|…/i, ce qui matchait « JSON invalide renvoyé par… » —
 * le message que ce module produit lui-même quand une réponse arrive tronquée.
 * Résultat : la panne la plus banale était déclarée fatale et jamais réessayée.
 * On ne se fie donc qu'au type de l'erreur et au code HTTP structuré.
 */
function isFatal(error: unknown): boolean {
  if (error instanceof FatalApiError) return true;
  const candidate = error as { status?: unknown; code?: unknown };
  const status = typeof candidate?.status === "number" ? candidate.status
    : typeof candidate?.code === "number" ? candidate.code
    : null;
  return status !== null && [400, 401, 403, 404].includes(status);
}

/** Plafond du délai d'attente suggéré par le serveur, pour ne pas figer un lot. */
const MAX_SUGGESTED_DELAY_MS = 65_000;

/**
 * Délai d'attente que le serveur recommande, s'il en donne un.
 *
 * Sur un quota de débit, Google répond « Please retry in 31.9s ». Attendre nos
 * 1-2-4 s puis abandonner gâche une scène déjà payée alors que la fenêtre allait
 * se rouvrir. Lire cette indication n'est pas la même chose que classer une erreur
 * sur son texte : ici, ne rien trouver retombe simplement sur le recul exponentiel.
 */
function suggestedDelayMs(error: unknown): number | null {
  const structured = (error as { retryDelay?: unknown })?.retryDelay;
  if (typeof structured === "number" && structured > 0) return Math.min(structured * 1000, MAX_SUGGESTED_DELAY_MS);

  const message = error instanceof Error ? error.message : String(error);
  const match = /retry in ([\d.]+)s/i.exec(message);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  // Une seconde de marge : revenir pile à l'échéance se fait souvent refuser.
  return Math.min(Math.ceil(seconds * 1000) + 1000, MAX_SUGGESTED_DELAY_MS);
}

/**
 * Réessaie avec un recul exponentiel. Un lot de 60 puzzles enchaîne des centaines
 * d'appels : un 429 ou un 503 passager ne doit pas faire tomber toute la session.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (isFatal(error)) throw error;
      if (i === attempts - 1) break;
      const message = error instanceof Error ? error.message : String(error);
      const delay = suggestedDelayMs(error) ?? 1000 * 2 ** i;
      console.warn(`  ↻ ${label} : échec (${message.slice(0, 120)}), nouvel essai dans ${delay}ms`);
      await sleep(delay);
    }
  }
  throw new Error(`${label} : abandon après ${attempts} tentatives — ${String(lastError)}`);
}

// ---------------------------------------------------------------------------
// Génération d'image
// ---------------------------------------------------------------------------

export interface ImageOptions {
  aspectRatio?: string;
  imageSize?: "512px" | "1K" | "2K" | "4K";
  model?: string;
}

export async function generateImage(
  prompt: string,
  { aspectRatio = "16:9", imageSize = "2K", model = IMAGE_MODEL }: ImageOptions = {},
): Promise<Buffer> {
  return withRetry("generateImage", async () => {
    const interaction = await ai().interactions.create({
      model,
      input: prompt,
      response_format: {
        type: "image",
        // JPEG est le seul format de sortie accepté par les modèles d'image
        // (« The value 'image/png' is not supported […] Supported values:
        // 'image/jpeg' »). generateScene transcode ensuite une fois en PNG, pour
        // que les crops de l'inventaire ne subissent pas une seconde compression.
        mime_type: "image/jpeg",
        aspect_ratio: aspectRatio,
        image_size: imageSize,
      },
    } as never);

    const image = (interaction as { output_image?: { data?: string } }).output_image;
    if (!image?.data) {
      // On expose la forme réelle : c'est le premier point où le SDK peut diverger
      // de la documentation, et un message vague coûterait une demi-heure.
      throw new Error(
        `Aucune image dans la réponse. Clés reçues : ${Object.keys(interaction as object).join(", ")}`,
      );
    }

    costTracker.images++;
    costTracker.dollars += PRICING.imagePerCall[imageSize] ?? PRICING.imagePerCall["2K"];
    return Buffer.from(image.data, "base64");
  });
}

// ---------------------------------------------------------------------------
// Lecture d'image / sortie structurée
// ---------------------------------------------------------------------------

export interface AskJSONOptions {
  prompt: string;
  /** PNG/JPEG brut. Omettre pour une requête purement textuelle. */
  image?: Buffer;
  imageMimeType?: string;
  /** JSON Schema imposé au modèle — c'est lui qui garantit un vocabulaire fermé. */
  schema: object;
  model?: string;
  temperature?: number;
}

export async function askJSON<T>({
  prompt, image, imageMimeType = "image/png", schema, model = VISION_MODEL, temperature,
}: AskJSONOptions): Promise<T> {
  return withRetry("askJSON", async () => {
    const input: unknown[] = [{ type: "text", text: prompt }];
    if (image) {
      // Forme attendue pour une image inline : data + mime_type au même niveau.
      // Un objet `source: { type: "base64", media_type… }` est refusé
      // (« Unknown parameter 'source' »).
      input.push({
        type: "image",
        data: image.toString("base64"),
        mime_type: imageMimeType,
      });
    }

    const interaction = await ai().interactions.create({
      model,
      input,
      response_format: { type: "text", mime_type: "application/json", schema },
      // Les paramètres d'échantillonnage sont imbriqués dans generation_config ;
      // au premier niveau l'API répond « Unknown parameter 'temperature' ».
      ...(temperature !== undefined ? { generation_config: { temperature } } : {}),
    } as never);

    const raw = (interaction as { output_text?: string }).output_text;
    if (!raw) {
      throw new Error(
        `Réponse vide. Clés reçues : ${Object.keys(interaction as object).join(", ")}`,
      );
    }

    // Les champs sont `total_input_tokens` / `total_output_tokens` ; avec
    // `input_tokens` / `output_tokens` le compteur restait obstinément à zéro.
    // Les variantes sont tolérées pour ne pas se taire si l'API évolue.
    const usage = (interaction as {
      usage?: Record<string, number | undefined>;
    }).usage;
    costTracker.visionCalls++;
    if (usage) {
      const inputTokens = usage.total_input_tokens ?? usage.input_tokens ?? 0;
      // Les tokens de réflexion sont facturés au tarif de sortie : les omettre
      // sous-estimerait le coût réel, et c'est ce compteur qui guidera le budget.
      const outputTokens =
        (usage.total_output_tokens ?? usage.output_tokens ?? 0) + (usage.total_thought_tokens ?? 0);

      costTracker.inputTokens += inputTokens;
      costTracker.outputTokens += outputTokens;
      costTracker.dollars +=
        (inputTokens / 1e6) * PRICING.visionInputPerMillion +
        (outputTokens / 1e6) * PRICING.visionOutputPerMillion;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      // Volontairement PAS une FatalApiError : une réponse tronquée est un
      // incident passager, et un nouvel essai a toutes les chances d'aboutir.
      throw new Error(`JSON invalide renvoyé par ${model} : ${raw.slice(0, 200)}`);
    }
  });
}

/** Exécute des tâches en parallèle avec un plafond, pour ne pas saturer les quotas. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
