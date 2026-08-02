"use client";

/**
 * Écran de jeu.
 *
 * Tout est résolu côté client : le numéro du puzzle dépend de la date LOCALE du
 * joueur, que le serveur n'a aucun moyen de connaître au moment du build. On attend
 * donc le montage avant de décider quoi afficher — d'où l'état `loading`, qui évite
 * au passage toute divergence d'hydratation.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AttemptTracker } from "@/components/AttemptTracker";
import { CluePanel } from "@/components/CluePanel";
import { ResultModal } from "@/components/ResultModal";
import { SceneViewer } from "@/components/SceneViewer";
import { UI, detectLocale, type Strings } from "@/lib/i18n";
import {
  attemptsLeft, initialState, registerClick, revealedClueCount,
  type GameState, type Point,
} from "@/lib/game-state";
import { puzzleNumberFor } from "@/lib/puzzle";
import { decodeSolution, type SolutionPayload } from "@/lib/solution";
import { EMPTY_STATS, loadGame, loadStats, recordResult, saveGame, type Stats } from "@/lib/storage";
import type { BBox, Locale, Puzzle } from "@/lib/types";

/**
 * Langue, numéro du jour et puzzle proviennent tous d'API disponibles uniquement
 * dans le navigateur. Ils sont regroupés dans un état unique, résolu en une fois
 * après le chargement : rien n'est écrit dans l'état pendant le corps de l'effet,
 * ce qui évite les rendus en cascade et l'affichage fugace d'un numéro à zéro.
 */
type Phase =
  | { kind: "loading"; locale: Locale }
  | { kind: "missing"; locale: Locale; number: number }
  | { kind: "ready"; locale: Locale; number: number; puzzle: Puzzle; solution: SolutionPayload };

export default function Home() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading", locale: "fr" });
  const [state, setState] = useState<GameState>(initialState);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [modalOpen, setModalOpen] = useState(false);

  const locale = phase.locale;
  const number = phase.kind === "loading" ? 0 : phase.number;
  const strings: Strings = UI[locale];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const detected = detectLocale();
      const n = puzzleNumberFor(new Date());
      try {
        const response = await fetch(`/puzzles/${n}.json`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const puzzle = (await response.json()) as Puzzle;
        const solution = decodeSolution(puzzle.solution.token, puzzle.number);
        if (cancelled) return;

        // Une partie déjà entamée aujourd'hui reprend où elle s'était arrêtée.
        const resumed = loadGame(n) ?? initialState();
        setPhase({ kind: "ready", locale: detected, number: n, puzzle, solution });
        setState(resumed);
        // recordResult est idempotent : rouvrir la page d'une partie finie ne
        // regonfle ni les compteurs ni la série.
        setStats(resumed.status === "playing" ? loadStats() : recordResult(n, resumed));
        if (resumed.status !== "playing") setModalOpen(true);
      } catch {
        if (!cancelled) setPhase({ kind: "missing", locale: detected, number: n });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const finished = state.status !== "playing";

  // La boîte de la solution n'entre dans l'arbre React qu'une fois la partie
  // terminée : tant qu'on joue, elle n'est nulle part dans le DOM.
  const reveal: BBox | null = finished && phase.kind === "ready" ? phase.solution.bbox : null;

  const onPick = useCallback((point: Point) => {
    if (phase.kind !== "ready" || state.status !== "playing") return;
    const next = registerClick(state, point, phase.solution.bbox);
    setState(next);
    saveGame(phase.puzzle.number, next);
    if (next.status !== "playing") {
      setStats(recordResult(phase.puzzle.number, next));
      // Laisse voir le halo sur la solution avant de couvrir l'écran.
      setTimeout(() => setModalOpen(true), 900);
    }
  }, [phase, state]);

  const clues = useMemo(
    () => (phase.kind === "ready" ? phase.puzzle.clues[locale] ?? phase.puzzle.clues.fr : []),
    [phase, locale],
  );

  const revealed = revealedClueCount(state);
  const left = attemptsLeft(state);

  return (
    <main className="mx-auto flex h-dvh w-full max-w-6xl flex-col gap-3 p-3 sm:p-4">
      <header className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black tracking-tight sm:text-2xl">
            Slushy{number > 0 && <span className="ml-1.5 text-neutral-400">#{number}</span>}
          </h1>
          <p className="hidden text-xs text-neutral-500 sm:block">{strings.tagline}</p>
        </div>
        <div className="flex items-center gap-3">
          <AttemptTracker attempts={state.attempts} />
          {finished && (
            <button
              onClick={() => setModalOpen(true)}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-bold text-white
                         dark:bg-white dark:text-neutral-900"
            >
              {strings.stats}
            </button>
          )}
        </div>
      </header>

      {phase.kind === "loading" && (
        <div className="grid flex-1 place-items-center text-sm text-neutral-500">
          {strings.loading}
        </div>
      )}

      {phase.kind === "missing" && (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div>
            <p className="text-lg font-bold">{strings.noPuzzle}</p>
            <p className="mt-1 text-sm text-neutral-500">{strings.noPuzzleBody}</p>
          </div>
        </div>
      )}

      {phase.kind === "ready" && (
        <>
          <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
            <div className="relative min-h-0 flex-1">
              <SceneViewer
                src={phase.puzzle.image.src}
                imageWidth={phase.puzzle.image.width}
                imageHeight={phase.puzzle.image.height}
                attempts={state.attempts}
                reveal={reveal}
                disabled={finished}
                onPick={onPick}
              />
              <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full
                            bg-black/55 px-3 py-1 text-[11px] text-white">
                {strings.zoomHint}
              </p>
            </div>

            <aside className="flex shrink-0 flex-col gap-3 lg:w-80">
              <CluePanel clues={clues} revealed={revealed} strings={strings} />
              <p className="text-center text-xs text-neutral-500">
                {state.status === "playing" && (
                  <>
                    {state.attempts.length === 0
                      ? strings.instructions
                      : left === 1 ? strings.lastChance : strings.wrong}
                    {` · ${strings.attemptsLeft(left)}`}
                  </>
                )}
              </p>
            </aside>
          </div>

          <ResultModal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            puzzleNumber={phase.puzzle.number}
            state={state}
            stats={stats}
            solutionLabel={state.status === "lost" ? phase.solution.label : null}
            locale={locale}
            strings={strings}
          />
        </>
      )}
    </main>
  );
}
