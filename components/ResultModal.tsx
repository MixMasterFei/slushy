"use client";

/**
 * Écran de fin : résultat, partage, statistiques, compte à rebours.
 *
 * Le partage passe par l'API native quand elle existe (elle ouvre la feuille de
 * partage du téléphone, là où le jeu se joue le plus), et retombe sur le
 * presse-papiers ailleurs. Aucun des deux ne divulgue la solution.
 */

import { useEffect, useState } from "react";
import { formatCountdown, msUntilNextPuzzle } from "@/lib/puzzle";
import { shareText } from "@/lib/share";
import { winningAttempt, type GameState } from "@/lib/game-state";
import { MAX_ATTEMPTS, type Locale } from "@/lib/types";
import { winRate, type Stats } from "@/lib/storage";
import type { Strings } from "@/lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
  puzzleNumber: number;
  state: GameState;
  stats: Stats;
  solutionLabel: string | null;
  locale: Locale;
  strings: Strings;
}

export function ResultModal({
  open, onClose, puzzleNumber, state, stats, solutionLabel, locale, strings,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState("");

  useEffect(() => {
    if (!open) return;
    const tick = () => setCountdown(formatCountdown(msUntilNextPuzzle(new Date())));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const won = state.status === "won";
  const attempt = winningAttempt(state);
  const text = shareText(puzzleNumber, state, locale);

  const onShare = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Partage refusé ou annulé par l'utilisateur : rien à signaler.
    }
  };

  const best = Math.max(1, ...stats.distribution);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-center text-2xl font-black tracking-tight">
          {won ? strings.won : strings.lost}
        </h2>
        <p className="mt-1 text-center text-sm text-neutral-500 dark:text-neutral-400">
          {won && attempt ? strings.wonIn(attempt) : strings.lostBody}
        </p>
        {!won && solutionLabel && (
          <p className="mt-2 text-center text-sm font-medium">« {solutionLabel} »</p>
        )}

        <dl className="mt-5 grid grid-cols-4 gap-2 text-center">
          {[
            [stats.played, strings.played],
            [winRate(stats), strings.winRate],
            [stats.currentStreak, strings.streak],
            [stats.maxStreak, strings.maxStreak],
          ].map(([value, label]) => (
            <div key={String(label)}>
              <dt className="text-xl font-bold tabular-nums">{value}</dt>
              <dd className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</dd>
            </div>
          ))}
        </dl>

        <section className="mt-5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            {strings.distribution}
          </h3>
          <div className="mt-2 flex flex-col gap-1">
            {Array.from({ length: MAX_ATTEMPTS }, (_, i) => {
              const count = stats.distribution[i] ?? 0;
              const isCurrent = won && attempt === i + 1;
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-3 tabular-nums text-neutral-500">{i + 1}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className={`flex h-full min-w-6 items-center justify-end rounded px-1.5
                        font-semibold text-white tabular-nums
                        ${isCurrent ? "bg-emerald-500" : "bg-neutral-400 dark:bg-neutral-600"}`}
                      style={{ width: `${Math.max(8, (count / best) * 100)}%` }}
                    >
                      {count}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="mt-6 flex items-center justify-between gap-4">
          <div className="text-left">
            <p className="text-[10px] uppercase tracking-wide text-neutral-500">{strings.next}</p>
            <p className="text-lg font-bold tabular-nums">{countdown}</p>
          </div>
          <button
            onClick={onShare}
            className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white
                       transition-colors hover:bg-emerald-700 active:bg-emerald-800"
          >
            {copied ? strings.copied : strings.share}
          </button>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full text-center text-xs text-neutral-500 hover:underline"
        >
          {strings.close}
        </button>
      </div>
    </div>
  );
}
