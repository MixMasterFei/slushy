"use client";

/**
 * Visionneuse de scène : zoom, déplacement, et conversion d'un clic en
 * coordonnées normalisées de l'image.
 *
 * Toute la difficulté tient dans une seule exigence : le clic doit désigner un
 * point de l'IMAGE, pas de l'écran. L'utilisateur zoome, fait glisser, tourne son
 * téléphone — la position visée doit rester la même. On gère donc la transformation
 * à la main plutôt que de laisser le navigateur ajuster l'image, ce qui permet de
 * l'inverser exactement au moment du clic.
 *
 * Distinguer un clic d'un glissement compte tout autant : sur mobile, un doigt qui
 * se déplace de trois pixels pendant un pan ne doit pas brûler un essai.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { BBox } from "@/lib/types";
import type { Attempt, Point } from "@/lib/game-state";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/** Au-delà de ce déplacement (px), le geste est un pan et non un clic. */
const DRAG_THRESHOLD = 6;

interface View {
  zoom: number;
  tx: number;
  ty: number;
}

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ zoom: 1, tx: 0, ty: 0 });

  // Gestes en cours. Volontairement dans des refs : ces valeurs changent à chaque
  // pixel parcouru et n'ont aucune raison de déclencher un rendu.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ dragging: false, moved: 0, lastX: 0, lastY: 0, pinchDist: 0 });

  /** Échelle « contain » pour un conteneur donné : l'image entière est visible à zoom 1. */
  const fitScale = useCallback(
    (w: number, h: number) => (w && imageWidth ? Math.min(w / imageWidth, h / imageHeight) : 0),
    [imageWidth, imageHeight],
  );

  const baseScale = fitScale(size.w, size.h);
  const scale = baseScale * view.zoom;
  const shownW = imageWidth * scale;
  const shownH = imageHeight * scale;

  /**
   * Empêche l'image de dériver hors du cadre ; la recentre si elle y tient
   * entièrement. Prend les dimensions du conteneur en argument plutôt que de les
   * lire dans l'état : le ResizeObserver doit pouvoir recadrer avec les NOUVELLES
   * dimensions, avant même que l'état ait été mis à jour.
   */
  const clamp = useCallback((v: View, w: number, h: number): View => {
    const s = fitScale(w, h) * v.zoom;
    const dw = imageWidth * s;
    const dh = imageHeight * s;
    const tx = dw <= w ? (w - dw) / 2 : Math.min(0, Math.max(w - dw, v.tx));
    const ty = dh <= h ? (h - dh) / 2 : Math.min(0, Math.max(h - dh, v.ty));
    return { zoom: v.zoom, tx, ty };
  }, [fitScale, imageWidth, imageHeight]);

  // Premier calibrage et redimensionnements (rotation du téléphone, barre
  // d'adresse qui se replie…). Le recadrage se fait dans la réponse à l'événement
  // externe plutôt que dans un effet qui observerait `size`, ce qui déclencherait
  // un rendu en cascade à chaque pixel parcouru.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const apply = (width: number, height: number) => {
      setSize({ w: width, h: height });
      setView((v) => clamp(v, width, height));
    };

    // Mesure initiale synchrone. Indispensable : ResizeObserver ne livre son
    // premier callback qu'au prochain cycle de rendu, et un onglet qui ne
    // composite pas (arrière-plan, prévisualisation masquée) peut ne jamais
    // l'émettre. Sans cette mesure, l'échelle resterait à 0 et la scène
    // invisible. C'est précisément l'usage de useLayoutEffect : lire le DOM
    // une fois la mise en page faite.
    apply(el.clientWidth, el.clientHeight);

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      apply(width, height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [clamp]);

  /** Zoome autour d'un point de l'écran, qui reste immobile sous le doigt. */
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      if (zoom === v.zoom) return v;
      const s = baseScale * v.zoom;
      const s2 = baseScale * zoom;
      // Le point image sous le curseur doit rester sous le curseur.
      const ix = (px - v.tx) / s;
      const iy = (py - v.ty) / s;
      return clamp({ zoom, tx: px - ix * s2, ty: py - iy * s2 }, rect.width, rect.height);
    });
  }, [baseScale, clamp]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, [zoomAt]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    try {
      // Lève une InvalidPointerId si le pointeur n'est plus actif — ce qui arrive
      // pour de bon lors d'un toucher interrompu par un appel ou un geste système.
      // La capture est un confort (le glissement survit à la sortie du cadre),
      // pas une nécessité : son échec ne doit pas casser la partie.
      (e.target as Element).setPointerCapture?.(e.pointerId);
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
      if (previous > 0 && dist > 0) {
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / previous);
      }
      gesture.current.pinchDist = dist;
      return;
    }

    if (!gesture.current.dragging) return;
    const dx = e.clientX - gesture.current.lastX;
    const dy = e.clientY - gesture.current.lastY;
    gesture.current.moved += Math.abs(dx) + Math.abs(dy);
    gesture.current.lastX = e.clientX;
    gesture.current.lastY = e.clientY;
    const el = containerRef.current;
    if (!el) return;
    setView((v) => clamp({ ...v, tx: v.tx + dx, ty: v.ty + dy }, el.clientWidth, el.clientHeight));
  }, [clamp, zoomAt]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const wasDragging = gesture.current.dragging;
    const moved = gesture.current.moved;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current.dragging = false;
    if (pointers.current.size < 2) gesture.current.pinchDist = 0;

    // Seul un geste unique et quasi immobile compte comme une tentative.
    if (!wasDragging || moved > DRAG_THRESHOLD || disabled) return;

    const el = containerRef.current;
    if (!el || !scale) return;
    const rect = el.getBoundingClientRect();
    const ix = (e.clientX - rect.left - view.tx) / scale / imageWidth;
    const iy = (e.clientY - rect.top - view.ty) / scale / imageHeight;
    if (ix < 0 || ix > 1 || iy < 0 || iy > 1) return; // clic dans la marge, hors image
    onPick({ x: ix, y: iy });
  }, [disabled, imageHeight, imageWidth, onPick, scale, view.tx, view.ty]);

  /** Coordonnées image normalisées → position en pixels dans le conteneur. */
  const toScreen = (nx: number, ny: number) => ({
    left: view.tx + nx * shownW,
    top: view.ty + ny * shownH,
  });

  return (
    <div
      ref={containerRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`relative h-full w-full overflow-hidden rounded-xl bg-neutral-200 dark:bg-neutral-800
        ${disabled ? "cursor-default" : "cursor-crosshair"} touch-none select-none`}
      style={{ contain: "paint" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        width={imageWidth}
        height={imageHeight}
        className="absolute origin-top-left will-change-transform"
        style={{
          transform: `translate3d(${view.tx}px, ${view.ty}px, 0) scale(${scale})`,
          transformOrigin: "0 0",
          imageRendering: view.zoom > 3 ? "pixelated" : "auto",
        }}
      />

      {/* Croix persistantes : le joueur doit voir où il a déjà cherché. */}
      {attempts.filter((a) => !a.correct).map((a, i) => {
        const { left, top } = toScreen(a.point.x, a.point.y);
        return (
          <span
            key={i}
            aria-hidden
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-xl font-black
                       text-red-600 drop-shadow-[0_0_3px_rgba(255,255,255,0.95)]"
            style={{ left, top }}
          >
            ✕
          </span>
        );
      })}

      {reveal && (
        <span
          aria-hidden
          className="pointer-events-none absolute animate-pulse rounded-lg border-4 border-emerald-400
                     shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          style={{
            left: view.tx + reveal.x * shownW,
            top: view.ty + reveal.y * shownH,
            width: reveal.w * shownW,
            height: reveal.h * shownH,
          }}
        />
      )}
    </div>
  );
}
