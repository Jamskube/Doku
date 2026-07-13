# 0007. Recherche plein-texte : index en mémoire (scan-once, watcher-invalidé)

**Date** : 2026-07-13 · **Status** : accepted · **Deciders** : nicos (+ Claude) · **Tags** : recherche, perf, arm64 · **Spike** : 9.1

## Context

Le PRD-v1.5 (FR-1) exige une recherche plein-texte dans un dossier de notes en **< 300 ms sur ~1000 fichiers (~5 Mo)**, avec un panneau qui liste les résultats **à la saisie**. Dans Doku, lire un fichier passe par `readTextFileAt` (`@tauri-apps/plugin-fs`) = **un aller-retour IPC par fichier** — c'est le coût dominant. Le spike 9.1 devait trancher, par la mesure, entre deux stratégies avant de coder le moteur (9.2) :
- **A. scan-par-recherche** — relire tous les fichiers à chaque requête ;
- **B. index-en-mémoire** — lire une fois, cacher, chercher en mémoire.

## Decision drivers

- Budget **< 300 ms par recherche** (NFR), et recherche **réactive** (panneau qui liste à la frappe).
- **La lecture IPC par fichier est le goulot** — pas le matching de chaîne (trivial).
- Alignement avec le pattern existant : `WikilinkResolver` fait déjà « scan à l'ouverture du dossier + cache invalidé par watcher » (architecture.md).
- ~5 Mo de corpus est **négligeable en mémoire**.
- Pattern maison « logique pure testable » (cf. `table.ts`, `wikilink.ts`).

## Mesures (spike 9.1)

Benchmark Node (`scratchpad/bench-search.mjs`) — 1000 fichiers, 5,11 Mo. **Node fs = plancher** : l'IPC Tauri est nettement plus lent par fichier, ce qui **creuse l'écart en faveur de B**.

| Stratégie | Coût | Détail |
|---|---|---|
| A. scan-par-recherche | **20-50 ms / requête** | lit les 1000 fichiers **à chaque** requête |
| B. index — build | 23 ms (une fois) | lecture unique + lowercase, ~10,2 Mo en mémoire |
| B. index — recherche | **0,4-1,6 ms / requête** | substring `includes` en mémoire |

## Considered options

### Option A : scan-par-recherche
· Pros : zéro mémoire persistante, toujours frais, trivial.
· Cons : paie la lecture IPC de N fichiers **à chaque** requête → **intenable en as-you-type** (une passe par frappe) ; risqué même en soumission à 1000+ fichiers vu le coût IPC.

### Option B : index-en-mémoire (scan-once + cache + invalidation)
· Pros : recherche **< 2 ms** (marge > 200× sous le budget) ; le coût de lecture IPC est payé **une seule fois** ; aligné `WikilinkResolver` ; aucune dépendance tierce.
· Cons : ~2× la taille du corpus en mémoire (original + lowercased) ; latence *one-time* au build (ouverture dossier / 1re recherche) ; invalidation à gérer.

### Option C : lib d'index tierce (minisearch / lunr / fuse)
· Pros : fuzzy, ranking, tokenisation.
· Cons : dépendance + poids, **sur-dimensionnée** à cette échelle (substring < 2 ms suffit) ; va à l'encontre du biais « libs éprouvées **mais minimales** ». **Rejetée.**

## Decision

**Choisi : Option B.** Le budget 300 ms est *par recherche* → l'index le tient avec **> 200× de marge**. Le coût de lecture (IPC, le vrai goulot, amplifié en natif) est **amorti à une seule fois** au lieu d'être répété à chaque frappe. Le build *one-time* est un coût « ouverture de dossier / 1re recherche » — **hors** du budget par-recherche — et peut être asynchrone (résultats progressifs + indicateur).

### Forme pour la story 9.2
- **SearchService** : index `Map<path, { name, content, lower }>` construit **paresseusement** à la 1re recherche sur un dossier (ou à l'ouverture du dossier), via `scanFiles(dir, maxDepth=4)` déjà existant.
- **Filtrer AVANT lecture** : `isSupportedFile` + `detectUnsupported` (ne jamais indexer un binaire) ; `readTextFile` qui lève (UTF-8 invalide) → fichier ignoré (comme les boucles reload existantes).
- **Invalidation** : rebuild à l'ouverture du dossier + au save d'un fichier indexé + refresh explicite ; légère péremption tolérée (usage perso mono-utilisateur).
- **Matching pur et testable** dans un module séparé (`search.ts` : construction d'extrait + surlignage), comme `table.ts`/`wikilink.ts` — garde anti-périmé (req-token) côté store, cf. `loadSnapshotsForActive`.
- **Bornes explicites** : `maxDepth` + plafond nombre/taille de fichiers avec **notice loggée** (jamais de cap silencieux — règle AGENTS.md).

## Consequences

**Positive** : recherche quasi instantanée (< 2 ms), marge NFR énorme ; as-you-type possible ; aligné sur le pattern existant ; aucune dépendance tierce.
**Negative** : ~2× le corpus en mémoire (10 Mo pour 5 Mo) ; latence de build au 1er accès dossier ; logique d'invalidation à maintenir.
**Risks** :
- Index périmé si un fichier change hors watcher → rebuild à l'ouverture/save/refresh ; péremption douce assumée.
- Très gros dossiers (> 10k fichiers) → plafond + notice ; **option de repli** : ne stocker que `lower` et **re-lire le seul fichier matché** pour l'extrait (troque mémoire contre quelques IPC au moment du hit).

## Related

- `docs/planning/architecture.md` — `WikilinkResolver` (même pattern scan-once + cache + watcher), noyau + services
- `docs/planning/PRD-v1.5.md` — FR-1 (< 300 ms) ; `docs/planning/epics.md` — stories 9.2/9.3/9.4
- [ADR-0005](./0005-scope-fs-large-assume.md) — la recherche lit dans le même scope fs ; binaires exclus avant lecture
