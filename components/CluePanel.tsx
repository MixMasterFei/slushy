"use client";

/**
 * Les quatre indices, révélés au fil des erreurs.
 *
 * Les emplacements verrouillés restent visibles plutôt que masqués : voir qu'il
 * reste deux indices à venir fait partie de l'information stratégique du joueur —
 * il sait ce qu'il lui reste en réserve avant de risquer un clic.
 */

import type { Strings } from "@/lib/i18n";

interface Props {
  clues: readonly string[];
  revealed: number;
  strings: Strings;
}

export function CluePanel({ clues, revealed, strings }: Props) {
  return (
    <ol className="flex flex-col gap-2">
      {clues.map((clue, i) => {
        const isRevealed = i < revealed;
        const isLatest = i === revealed - 1;
        return (
          <li
            key={i}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors
              ${isRevealed
                ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900"
                : "border-dashed border-neutral-300 bg-transparent dark:border-neutral-800"}
              ${isLatest ? "ring-2 ring-amber-400/70" : ""}`}
          >
            <span
              className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold
                ${isRevealed
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "bg-neutral-200 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600"}`}
            >
              {i + 1}
            </span>
            {isRevealed ? (
              <span className="text-[15px] font-medium leading-snug">{clue}</span>
            ) : (
              <span className="text-[13px] italic text-neutral-400 dark:text-neutral-600">
                {strings.lockedClue}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
