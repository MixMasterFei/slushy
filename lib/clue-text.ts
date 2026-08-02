/**
 * Rendu FR/EN des prédicats en texte d'indice.
 *
 * Style « carte-indice » télégraphique, sans sujet ni verbe conjugué. Ce n'est pas
 * une coquetterie : en français « rayé / rayée » s'accorde avec le genre de l'objet,
 * que le pipeline ne connaît pas (l'inventaire manipule des slugs neutres). Les
 * tournures sans accord — « À rayures », « En train de courir » — suppriment le
 * problème, et donnent au passage des lignes plus courtes à l'écran.
 *
 * Les Record<T, string> exhaustifs font échouer la compilation si une valeur de
 * vocabulaire est ajoutée sans sa traduction.
 */

import type {
  Accessory, Action, Color, Kind, Locale, Pattern, Predicate, Size, ZoneX, ZoneY,
} from "./types";

type L10n = Record<Locale, string>;

const KIND_TEXT: Record<Kind, L10n> = {
  animal: { fr: "Un animal", en: "An animal" },
  person: { fr: "Une personne", en: "A person" },
  vehicle: { fr: "Un véhicule", en: "A vehicle" },
  food: { fr: "De la nourriture", en: "Something edible" },
  plant: { fr: "Une plante", en: "A plant" },
  furniture: { fr: "Un meuble", en: "A piece of furniture" },
  object: { fr: "Un objet", en: "An object" },
  building: { fr: "Un bâtiment", en: "A building" },
};

const COLOR_TEXT: Record<Color, L10n> = {
  red: { fr: "De couleur rouge", en: "Red" },
  orange: { fr: "De couleur orange", en: "Orange" },
  yellow: { fr: "De couleur jaune", en: "Yellow" },
  green: { fr: "De couleur verte", en: "Green" },
  blue: { fr: "De couleur bleue", en: "Blue" },
  purple: { fr: "De couleur violette", en: "Purple" },
  pink: { fr: "De couleur rose", en: "Pink" },
  brown: { fr: "De couleur marron", en: "Brown" },
  black: { fr: "De couleur noire", en: "Black" },
  white: { fr: "De couleur blanche", en: "White" },
  grey: { fr: "De couleur grise", en: "Grey" },
};

const SIZE_TEXT: Record<Size, L10n> = {
  small: { fr: "De petite taille", en: "Small" },
  medium: { fr: "De taille moyenne", en: "Medium-sized" },
  large: { fr: "De grande taille", en: "Large" },
};

const PATTERN_TEXT: Record<Pattern, L10n> = {
  plain: { fr: "Sans motif", en: "No pattern" },
  striped: { fr: "À rayures", en: "Striped" },
  dotted: { fr: "À pois", en: "Spotted" },
  checkered: { fr: "À carreaux", en: "Checkered" },
  floral: { fr: "À fleurs", en: "Floral" },
};

const ACCESSORY_TEXT: Record<Accessory, L10n> = {
  hat: { fr: "Porte un chapeau", en: "Wearing a hat" },
  cap: { fr: "Porte une casquette", en: "Wearing a cap" },
  glasses: { fr: "Porte des lunettes", en: "Wearing glasses" },
  scarf: { fr: "Porte une écharpe", en: "Wearing a scarf" },
  bag: { fr: "Porte un sac", en: "Carrying a bag" },
  umbrella: { fr: "Avec un parapluie", en: "With an umbrella" },
  helmet: { fr: "Porte un casque", en: "Wearing a helmet" },
  bowtie: { fr: "Porte un nœud papillon", en: "Wearing a bow tie" },
  crown: { fr: "Porte une couronne", en: "Wearing a crown" },
  gloves: { fr: "Porte des gants", en: "Wearing gloves" },
  boots: { fr: "Porte des bottes", en: "Wearing boots" },
  necklace: { fr: "Porte un collier", en: "Wearing a necklace" },
};

const ACTION_TEXT: Record<Action, L10n> = {
  standing: { fr: "Debout", en: "Standing" },
  sitting: { fr: "En position assise", en: "Sitting" },
  lying: { fr: "En position allongée", en: "Lying down" },
  walking: { fr: "En train de marcher", en: "Walking" },
  running: { fr: "En train de courir", en: "Running" },
  jumping: { fr: "En train de sauter", en: "Jumping" },
  flying: { fr: "En train de voler", en: "Flying" },
  sleeping: { fr: "En train de dormir", en: "Sleeping" },
  eating: { fr: "En train de manger", en: "Eating" },
  reading: { fr: "En train de lire", en: "Reading" },
  dancing: { fr: "En train de danser", en: "Dancing" },
  swimming: { fr: "En train de nager", en: "Swimming" },
};

const ZONE_X_TEXT: Record<ZoneX, L10n> = {
  left: { fr: "Dans la partie gauche", en: "In the left part" },
  center: { fr: "Dans la bande centrale", en: "In the middle column" },
  right: { fr: "Dans la partie droite", en: "In the right part" },
};

const ZONE_Y_TEXT: Record<ZoneY, L10n> = {
  top: { fr: "Dans le haut de la scène", en: "Near the top" },
  middle: { fr: "À mi-hauteur", en: "At mid-height" },
  bottom: { fr: "Dans le bas de la scène", en: "Near the bottom" },
};

const HOLDING_TEXT: Record<"true" | "false", L10n> = {
  true: { fr: "Tient quelque chose", en: "Holding something" },
  false: { fr: "Ne tient rien", en: "Not holding anything" },
};

export function clueText(p: Predicate, locale: Locale): string {
  switch (p.attr) {
    case "kind": return KIND_TEXT[p.value][locale];
    case "color": return COLOR_TEXT[p.value][locale];
    case "size": return SIZE_TEXT[p.value][locale];
    case "pattern": return PATTERN_TEXT[p.value][locale];
    case "accessories": return ACCESSORY_TEXT[p.value][locale];
    case "action": return ACTION_TEXT[p.value][locale];
    case "holding": return HOLDING_TEXT[p.value ? "true" : "false"][locale];
    case "zoneX": return ZONE_X_TEXT[p.value][locale];
    case "zoneY": return ZONE_Y_TEXT[p.value][locale];
  }
}

/** Rend la liste ordonnée d'indices dans les deux langues, prête à publier. */
export function renderClues(preds: readonly Predicate[]): Record<Locale, string[]> {
  return {
    fr: preds.map((p) => clueText(p, "fr")),
    en: preds.map((p) => clueText(p, "en")),
  };
}
