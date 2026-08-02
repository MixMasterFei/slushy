"use client";

/**
 * Visionneuse de scène : zoom, déplacement, et conversion d'un clic en
 * coordonnées normalisées de l'image.
 *
 * ---------------------------------------------------------------------------
 * Principe : c'est le NAVIGATEUR qui dimensionne, pas nous.
 * ---------------------------------------------------------------------------
 * Une version antérieure mesurait le conteneur, stockait la taille dans un état
 * React alimenté par ResizeObserver, et en dérivait une échelle. Fragile par
 * construction : si le callback n'arrivait jamais (onglet qui ne composite pas)
 * ou arrivait avec une valeur périmée, l'échelle restait fausse — jusqu'à zéro,
 * c'est-à-dire une scène invisible.
 *
 * Ici la boîte de l'image porte un `aspect-ratio` et des contraintes `max-*`, ce
 * qui laisse le moteur de rendu calculer lui-même la plus grande boîte au bon
 * ratio tenant dans le cadre. Aucun état de taille, aucune échelle calculée à la
 * main, rien à resynchroniser au redimensionnement.
 *
 * Conséquence directe : les coordonnées d'un clic se lisent sur la géométrie
 * réelle de cette boîte au moment du clic (`getBoundingClientRect`). Elles sont
 * donc justes par construction, quels que soient le zoom, le déplacement, la
 * taille de fenêtre ou l'orientation. Et comme les marqueurs vivent DANS cette
 * boîte et sont positionnés en pourcentages, ils suivent sans calcul.
 */

import { useCallback, useRef, useState } from "react";
import type { BBox } from "@/lib/types";
import type { Attempt, Point } from "@/lib/game-state";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/** Au-delà de ce déplacement (px), le geste est un pan et non un clic. */
const DRAG_THRESHOLD = 6;

interface Props {
  src: string;
  imageWidth: number;
  imageHeight: number;
  attempts: readonly Attempt[];
  /** Boîte de la solution, révélée uniquement en fin de partie. */
  reveal: BBox | null;
  disabled: boolean;
  onPick: (point: Point) => void;
}

export function SceneViewer({
  src, imageWidth, imageHeight, attempts, reveal, disabled, onPick,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Gestes en cours : dans des refs, car ces valeurs changent à chaque pixel
  // parcouru et n'ont aucune raison de déclencher un rendu.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ dragging: false, moved: 0, lastX: 0, lastY: 0, pinchDist: 0 });

  /**
   * Empêche de faire glisser la scène hors du cadre. Les dimensions au repos se
   * lisent sur le DOM (`offsetWidth` ignore la transformation d'un ancêtre), donc
   * toujours à jour sans qu'on ait à les suivre.
   */
  const clampPan = useCallback((next: { x: number; y: number }, z: number) => {
    const viewport = viewportRef.current;
    const box = boxRef.current;
    if (!viewport || !box) return next;
    const maxX = Math.max(0, (box.offsetWidth * z - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (box.offsetHeight * z - viewport.clientHeight) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }, []);

  /** Zoome autour d'un point de l'écran, qui reste immobile sous le doigt. */
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    setZoom((z) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
      if (next === z) return z;
      setPan((p) => {
        // Le point sous le curseur doit rester sous le curseur :
        //   écran = centre + pan + z · offset  ⇒  offset = (écran − centre − pan) / z
        const ratio = next / z;
        return clampPan(
          { x: clientX - cx - ratio * (clientX - cx - p.x), y: clientY - cy - ratio * (clientY - cy - p.y) },
          next,
        );
      });
      return next;
    });
  }, [clampPan]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, [zoomAt]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    try {
      // Lève une InvalidPointerId si le pointeur n'est plus actif — ce qui arrive
      // pour de bon lors d'un toucher interrompu par un appel ou un geste système.
      // La capture est un confort, pas une nécessité : son échec ne doit rien casser.
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* on continue sans capture */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      gesture.current = { dragging: true, moved: 0, lastX: e.clientX, lastY: e.clientY, pinchDist: 0 };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      // Un pincement n'est jamais un clic : on invalide le geste en cours.
      gesture.current.moved = DRAG_THRESHOLD + 1;
    }
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const previous = gesture.current.pinchDist;
      if (previous > 0 && dist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / previous);
      gesture.current.pinchDist = dist;
      return;
    }

    if (!gesture.current.dragging) return;
    const dx = e.clientX - gesture.current.lastX;
    const dy = e.clientY - gesture.current.lastY;
    gesture.current.moved += Math.abs(dx) + Math.abs(dy);
    gesture.current.lastX = e.clientX;
    gesture.current.lastY = e.clientY;
    setPan((p) => clampPan({ x: p.x + dx, y: p.y + dy }, zoom));
  }, [clampPan, zoom, zoomAt]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const wasDragging = gesture.current.dragging;
    const moved = gesture.current.moved;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current.dragging = false;
    if (pointers.current.size < 2) gesture.current.pinchDist = 0;

    // Seul un geste unique et quasi immobile compte comme une tentative.
    if (!wasDragging || moved > DRAG_THRESHOLD || disabled) return;

    const box = boxRef.current;
    if (!box) return;
    // La géométrie réelle de l'image à cet instant précis : zoom, déplacement et
    // taille de fenêtre y sont déjà intégrés. Rien à recalculer.
    const rect = box.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return; // clic dans la marge, hors image
    onPick({ x, y });
  }, [disabled, onPick]);

  const percent = (v: number) => `${v * 100}%`;

  return (
    <div
      ref={viewportRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`relative flex h-full w-full items-center justify-center overflow-hidden
        rounded-xl bg-neutral-200 dark:bg-neutral-800
        ${disabled ? "cursor-default" : "cursor-crosshair"} touch-none select-none`}
    >
      <div
        className="flex h-full w-full items-center justify-center will-change-transform"
        style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
      >
        {/*
          `h-full` donne une hauteur DÉFINIE dont `aspect-ratio` déduit la largeur ;
          `max-w-full` reprend la main quand le cadre est plus étroit, et le ratio
          recalcule alors la hauteur. C'est exactement un « contain », mais résolu
          par le moteur de rendu.

          Le point de départ défini est indispensable : avec seulement `max-h-full
          max-w-full`, la boîte se dimensionnait sur son contenu et l'image sur la
          boîte — une dépendance circulaire qui résout à ZÉRO, donc une scène
          invisible et des clics ignorés.

          Comme le ratio est le bon, il n'y a aucune bande vide : la boîte EST
          l'image. D'où des coordonnées exactes et des marqueurs positionnables en
          simples pourcentages.
        */}
        <div
          ref={boxRef}
          className="relative h-full max-h-full max-w-full"
          style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            draggable={false}
            className="block h-full w-full"
            style={{ imageRendering: zoom > 3 ? "pixelated" : "auto" }}
          />

          {/* Croix persistantes : le joueur doit voir où il a déjà cherché. */}
          {attempts.filter((a) => !a.correct).map((a, i) => (
            <span
              key={i}
              aria-hidden
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 font-black
                         text-red-600 drop-shadow-[0_0_3px_rgba(255,255,255,0.95)]"
              style={{
                left: percent(a.point.x),
                top: percent(a.point.y),
                // Contre-échelle : le marqueur garde la même taille à l'écran
                // quel que soit le zoom, au lieu de devenir énorme.
                fontSize: `${1.25 / zoom}rem`,
              }}
            >
              ✕
            </span>
          ))}

          {reveal && (
            <span
              aria-hidden
              className="pointer-events-none absolute animate-pulse rounded-lg border-emerald-400
                         shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
              style={{
                left: percent(reveal.x),
                top: percent(reveal.y),
                width: percent(reveal.w),
                height: percent(reveal.h),
                borderWidth: `${4 / zoom}px`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
