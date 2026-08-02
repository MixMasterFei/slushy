/**
 * Catalogue de thèmes et fabrication du prompt de scène.
 *
 * C'est ici que se joue la faisabilité de tout le pipeline. Le style n'est pas un
 * choix esthétique mais une **contrainte technique** : les aplats de couleur à fort
 * contraste et les sujets bien séparés sont précisément ce qui permet ensuite de
 * localiser les objets de façon fiable et de lire leurs attributs sans ambiguïté.
 * Un rendu peint, flou ou encombré ferait s'effondrer les étapes suivantes.
 */

export interface Theme {
  id: string;
  /** Décor, en anglais : les modèles d'image y sont nettement plus précis. */
  setting: string;
}

export const THEMES: Theme[] = [
  { id: "flea-market", setting: "a bustling outdoor flea market with stalls, crates and bric-a-brac" },
  { id: "beach", setting: "a summer beach with parasols, towels, swimmers and beach toys" },
  { id: "train-station", setting: "a busy train station concourse with travellers, luggage and benches" },
  { id: "funfair", setting: "a funfair with ride booths, balloons, stalls and fairgoers" },
  { id: "supermarket", setting: "a supermarket aisle with shelves, trolleys and shoppers" },
  { id: "library", setting: "a large public library with shelves, tables, readers and ladders" },
  { id: "construction", setting: "a construction site with workers, machines, pipes and materials" },
  { id: "airport", setting: "an airport departure hall with travellers, trolleys and seating" },
  { id: "park", setting: "a city park with picnickers, dogs, benches, ponds and cyclists" },
  { id: "ski-resort", setting: "a ski resort base area with skiers, sledges, chalets and equipment" },
  { id: "harbour", setting: "a fishing harbour with boats, crates, nets, gulls and dockworkers" },
  { id: "school-yard", setting: "a school playground with children, games, bags and play equipment" },
  { id: "farm", setting: "a farmyard with animals, tractors, hay bales, tools and farmers" },
  { id: "museum", setting: "a museum hall with display cases, statues, visitors and guards" },
  { id: "night-market", setting: "an evening street food market with stalls, lanterns and diners" },
  { id: "swimming-pool", setting: "a public swimming pool with bathers, floats, loungers and lifeguards" },
  { id: "campsite", setting: "a campsite with tents, campers, bicycles, cooking gear and trees" },
  { id: "zoo", setting: "a zoo path with enclosures, animals, visitors, signs and food carts" },
];

/** Variations pour que deux scènes d'un même thème ne se ressemblent pas. */
const PALETTES = [
  "warm palette of corals, mustards and teals",
  "cool palette of blues, mints and lilacs",
  "bold primary palette of reds, blues and yellows",
  "earthy palette of ochres, olives and terracottas",
  "candy palette of pinks, turquoises and creams",
];

const VIEWPOINTS = [
  "straight-on elevation view",
  "slightly elevated three-quarter view",
  "gentle top-down view at about 30 degrees",
];

/**
 * Prompt de génération.
 *
 * Chaque interdiction correspond à un mode d'échec constaté sur ce type de tâche :
 * le texte parasite pollue la détection d'objets, le chevauchement empêche de
 * découper des crops propres, le flou de profondeur détruit la lecture des
 * attributs, et un sujet coupé par le bord donne une bounding box fausse.
 */
export function scenePrompt(theme: Theme, variation: number): string {
  const palette = PALETTES[variation % PALETTES.length];
  const viewpoint = VIEWPOINTS[Math.floor(variation / PALETTES.length) % VIEWPOINTS.length];

  return `Flat vector illustration, modern children's picture-book style: ${theme.setting}.

COMPOSITION
- ${viewpoint}, everything in sharp focus, no depth of field.
- Around 30 distinct subjects: people, animals, vehicles and objects.
- Subjects are clearly SEPARATED from one another, with visible background between them.
- No subject overlaps or hides another. No subject is cut off by the edge of the frame.
- Spread the subjects across the whole frame, not clustered in the centre.

STYLE
- ${palette}.
- Solid flat colour fills with crisp edges and high contrast against the background.
- No gradients, no soft shading, no textures, no blur, no glow.

VARIETY (this matters more than realism)
- Deliberately vary each subject's colour, size and pose.
- Give many subjects a clearly visible accessory: hats, caps, glasses, scarves,
  bags, umbrellas, helmets, bow ties, crowns, gloves, boots or necklaces.
- Vary poses: standing, sitting, lying down, walking, running, jumping, sleeping,
  eating, reading, dancing.
- Include some patterned items: stripes, polka dots, checks, florals.

ABSOLUTELY NOT
- No text, no letters, no numbers, no written signs, no logos.
- No speech bubbles, no arrows, no labels.
- No photorealism, no painterly brushwork.`;
}

export function themeById(id: string): Theme {
  const theme = THEMES.find((t) => t.id === id);
  if (!theme) throw new Error(`Thème inconnu : ${id} (connus : ${THEMES.map((t) => t.id).join(", ")})`);
  return theme;
}

/** Thème choisi de façon déterministe à partir d'un index de lot. */
export function themeForIndex(index: number): Theme {
  return THEMES[index % THEMES.length];
}
