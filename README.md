# Slushy

Un puzzle par jour, le même pour toute la planète. Une scène illustrée dense, quatre indices
révélés au fil des erreurs, et **un seul objet** qui les coche tous.

Boucle inspirée de Wordle : une partie par jour, bascule à minuit local, série et grille de
partage sans spoiler.

---

## L'idée qui structure tout

Le jeu n'est jouable que si **exactement un** objet de l'image satisfait les 4 indices.

Or on ne peut pas imposer son contenu à un modèle texte→image : dès qu'il y a beaucoup de
sujets, les attributs migrent de l'un à l'autre — le chapeau atterrit sur le mauvais chat.
D'où le renversement dont découle toute l'architecture :

> On ne fabrique pas une image à partir d'indices.
> **On génère une scène, on lit ce qu'elle contient réellement, puis on calcule les indices.**

Les indices sont donc dérivés de l'image, jamais l'inverse : ils lui sont cohérents par
construction. Trois barrières successives protègent le joueur :

1. un **solveur déterministe** prouve l'unicité sur l'inventaire ;
2. une **vérification adverse** relit l'image en contexte vierge pour confirmer ;
3. une **revue humaine** valide avant publication.

---

## Deux moitiés étanches

### `tools/` — le pipeline, hors ligne

Ne tourne jamais en production. La clé API ne quitte pas la machine : `@google/genai` est en
`devDependencies`, ce qui rend une fuite vers le bundle client structurellement impossible.

| Étape | Rôle |
|---|---|
| `1-generate-scene` | Génère la scène (Gemini `gemini-3.1-flash-image`, 2K, 16:9) |
| `2-inventory` | **(a)** localise les régions, **(b)** décrit chaque crop isolément — 3 passes + vote |
| `3-solve-clues` | **Code pur, zéro IA.** Cherche 4 indices à solution unique |
| `4-verify` | Passe adverse : un contexte vierge doit trouver 1 objet, et le bon |
| `5-publish` | Écrit le JSON de jeu, l'audit et l'image WebP |

**Pourquoi l'inventaire est coupé en deux :** demander à un modèle de décrire trente objets
*et* de les localiser dans le même appel est ce qu'il fait de moins bien. Un seul objet par
requête supprime toute attribution croisée, et la bounding box vient de l'étape dédiée.

**`size` et `zone` ne sont jamais demandés au modèle** — sur un crop isolé, « petit ou
grand ? » n'a aucun référentiel. Ils se déduisent de la géométrie, donc ils sont exacts.

**Un attribut incertain est *inconnu*, pas *absent*.** Si les 3 passes divergent sur une
couleur, l'objet *pourrait* être rouge : il reste un concurrent possible. Le solveur porte donc
deux masques par indice (`definite` / `possible`) et n'accepte un puzzle que si l'unicité tient
quelle que soit la vraie valeur des attributs douteux.

### `app/` — le jeu, export statique

Aucun backend, aucune base, aucun appel API au runtime. Série et statistiques en
`localStorage`. Déployable sur n'importe quel CDN.

---

## Démarrer

```bash
npm install
npm run fixture
npm run dev
```

`npm run fixture` dessine une scène géométrique dont les attributs sont connus par
construction, et la fait passer par le vrai solveur et la vraie publication. Cela valide toute
la chaîne sans dépendre de Gemini. Le rendu est volontairement rudimentaire : c'est un
échafaudage de développement, pas le produit.

### Avec la clé Gemini

Copier `.env.example` vers `.env.local`, renseigner `GEMINI_API_KEY`, puis :

```bash
npm run spike -- --scenes 5
```

**À lancer avant tout le reste.** Tout le projet repose sur une hypothèse non vérifiée : Gemini
lit-il une scène dense de façon assez stable et assez précise ? Le spike y répond avec des
chiffres, sur quelques scènes, et produit des overlays à inspecter à l'œil — le critère de
localisation se tranche visuellement, pas au compteur.

Une fois le spike concluant :

```bash
npm run batch -- --count 10
npm run publish
```

---

## Commandes

| Commande | Effet |
|---|---|
| `npm run dev` / `build` | Jeu (le `prebuild` filtre les puzzles publiables) |
| `npm test` | 63 tests : solveur, machine à états, dates, géométrie |
| `npm run typecheck` / `lint` | Vérifications statiques |
| `npm run spike` | Mesure go/no-go de la lecture d'image |
| `npm run batch` / `publish` | Production de puzzles |
| `npm run fixture` | Puzzle de test, sans clé API |

---

## Déploiement

`vercel.json` fixe la configuration dans le dépôt plutôt que de la laisser à la détection
automatique. Trois choix y sont encodés :

**`framework: null`** — le projet ne contient aucune fonction serverless. Laisser Vercel
exécuter son builder Next.js le fait chercher dans `.next`, où un export statique n'écrit rien
de servable : le déploiement existe alors mais renvoie `NOT_FOUND` sur toutes les routes. En
désactivant le préréglage, Vercel se contente de servir `out/`.

**Cache** — `/puzzles/` en `must-revalidate` : le JSON change chaque jour, et un CDN qui le
garderait servirait le puzzle de la veille. `/img/` en `immutable` : les noms sont hachés.

**Reconstruction quotidienne** — indispensable, car `prepare-build.ts` ne recopie que les
puzzles jouables *à l'instant du build* : sans elle le jeu se fige au lendemain de la mise en
ligne. Vercel Cron ne convient pas (il invoque une fonction serverless, qu'un export statique
n'a pas), d'où une action GitHub planifiée qui déclenche un Deploy Hook. À configurer une fois :

1. Vercel → projet → *Settings* → *Git* → *Deploy Hooks* → créer un hook sur `main`
2. GitHub → *Settings* → *Secrets and variables* → *Actions* → secret `VERCEL_DEPLOY_HOOK`

L'URL du hook est un secret : quiconque la détient peut déclencher des déploiements.

## Points de vigilance

**Anti-spoiler.** `content/puzzles/` contient tout le stock d'avance ; sur un site statique, un
fichier présent est un fichier téléchargeable. `tools/prepare-build.ts` ne recopie vers
`public/puzzles/` que ce qui est jouable (jusqu'à J+1, pour couvrir UTC+14), et le déploiement
doit être reconstruit chaque jour. **Le dépôt doit rester privé.**

**L'obfuscation de la solution n'est pas de la sécurité.** Sur un jeu statique, le client doit
pouvoir valider un clic hors ligne : la réponse est nécessairement dans ce qu'on télécharge.
`lib/solution.ts` empêche seulement de la lire en clair dans le JSON. Wordle expédiait de même
toute sa liste de mots.

**Stock d'avance.** Garder ≥ 30 puzzles validés. Un jeu quotidien qui saute un jour est mort ;
une panne d'API ne doit jamais pouvoir couper la cadence.

**L'époque est gravée.** `EPOCH` dans `lib/puzzle.ts` fixe le puzzle n° 1. La décaler après le
lancement renumérote tout ce qui a déjà été publié et partagé.

**Vérification corrélée.** L'inventaire et la vérification adverse utilisent la même famille de
modèles : une hallucination partagée passerait deux fois. Brancher un second fournisseur
(`ANTHROPIC_API_KEY`) avant l'ouverture au public.

**Vulnérabilités connues.** `npm audit` signale `postcss` et une copie interne de `sharp`, tous
deux transitifs **dans Next.js lui-même**. `npm audit fix --force` rétrograderait Next 16 vers
Next 9 : à ne pas faire. Build-time uniquement, non exposé sur un site statique. Le `sharp`
direct du pipeline est en 0.35.3, la version corrigée.

**Windows — « npm n'est pas reconnu ».** Node est bien installé et bien inscrit dans le PATH
système (`C:\Program Files\nodejs\`). Mais un processus démarré **avant** cet ajout conserve
l'ancien environnement et le transmet à tout ce qu'il lance : dans un terminal ouvert depuis une
telle application, `npm` reste introuvable alors que la machine est correctement configurée.

Un nouvel onglet ne suffit pas — il hérite de son application hôte. Il faut soit ouvrir un
terminal depuis le **menu Démarrer**, soit **redémarrer l'application** (Cursor, VS Code…).

En dépannage, `scripts\npm.cmd` reconstruit le PATH et transmet les arguments à npm :

```
scripts\npm run dev
scripts\npm test
```

Ce script devient inutile dès l'environnement rafraîchi. Ses commentaires sont volontairement
en ASCII : `cmd.exe` lit les `.cmd` dans la page de code OEM, et des accents dans un `REM`
suffisent à parasiter chaque exécution de messages d'erreur.
