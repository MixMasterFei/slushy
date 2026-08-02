"use client";

/** Les cinq essais, dans le même vocabulaire visuel que la grille de partage. */

import { MAX_ATTEMPTS } from "@/lib/types";
import type { Attempt } from "@/lib/game-state";

interface Props {
  attempts: readonly Attempt[];
}

export function AttemptTracker({ attempts }: Props) {
  return (
    <div className="flex items-center gap-1.5" role="img"
      aria-label={`${attempts.length} essai(s) sur ${MAX_ATTEMPTS}`}>
      {Array.from({ length: MAX_ATTEMPTS }, (_, i) => {
        const attempt = attempts[i];
        const state = !attempt ? "unused" : attempt.correct ? "found" : "wrong";
        return (
          <span
            key={i}
            className={`size-5 rounded-[4px] border transition-colors
              ${state === "found" ? "border-emerald-600 bg-emerald-500" : ""}
              ${state === "wrong" ? "border-red-700 bg-red-500" : ""}
              ${state === "unused" ? "border-neutral-300 bg-transparent dark:border-neutral-700" : ""}`}
          />
        );
      })}
    </div>
  );
}
