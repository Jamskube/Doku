# 0009. Renderer Markdown → HTML pour l'export : `marked`

Date : 2026-07-13 · Status : accepted · Deciders : Kubo · Tags : export, markdown, rendu, fr-2

## Context

L'export (Epic 10, [ADR-0008](./0008-pipeline-export-pdf-window-print.md)) doit produire un PDF/HTML **fidèle au rendu** d'un document Markdown. Or Doku **n'a aucun renderer Markdown → HTML** : la live-preview décore du markdown brut via des décorations CodeMirror (DOM virtualisé, partiel, inexploitable pour l'impression). Le spike 10.1 a explicitement reporté ce rendu à 10.2. Il faut donc un moteur MD → HTML, contraint par : **100 % hors-ligne**, ESM/Vite, **arch-agnostique** (JS pur, pas de binaire — Windows ARM64), léger, et sûr (sortie assainie par DOMPurify puis injectée dans un iframe sandboxé).

`architecture.md` prévoyait déjà `marked` + DOMPurify (SanitizeService), jamais installé jusqu'ici.

## Decision drivers

- Fidélité GFM attendue (tableaux, listes de tâches, strikethrough, autolinks).
- Effort d'implémentation raisonnable (app perso).
- Minimalisme des dépendances (cf. [ADR-0007](./0007-recherche-index-memoire.md) : la recherche a évité une lib tierce car `includes` suffisait).
- Sécurité (raw HTML du markdown) — déjà couverte par le pipeline DOMPurify + sandbox.

## Considered options

### Option A : `marked`
- **Pros** : ~12 Ko gzip, quasi zéro-dép, ESM natif, **synchrone**, **GFM par défaut** (tables, tâches, strike, autolinks), API triviale (`marked.parse(md)`). Pur JS → offline/ARM64/Vite OK.
- **Cons** : ne sanitize pas (raw HTML passthrough) → exige un sanitize aval — **déjà en place** (DOMPurify + iframe sandbox + CSP `default-src none`).

### Option B : `markdown-it`
- **Pros** : `html:false` sûr par défaut, très configurable.
- **Cons** : ~30 Ko + **5-6 dépendances runtime** ; listes de tâches = plugin séparé, linkify off par défaut. Surdimensionné pour le besoin.

### Option C : walk `@lezer/markdown` (déjà bundlé transitivement)
- **Pros** : zéro dépendance ajoutée ; « même parseur que l'éditeur ».
- **Cons** : `@lezer/markdown` **ne produit aucun HTML** — il faut écrire tout le générateur Tree → HTML (~25-30 types de nœuds + edge-cases d'échappement) = **des jours de travail**. L'avantage « même parseur » est **illusoire** : la live-preview gère déjà les tableaux à part (`table.ts`) et n'émet pas de HTML.

## Decision

**Option A (`marked`) retenue.** C'est le cas d'école inverse d'ADR-0007 : là, `includes` suffisait ; ici, un rendu Markdown GFM correct (listes imbriquées, tables, code fence, précédence inline, échappement) **n'a pas d'équivalent simple fait-maison**, donc la lib remplace des jours de code non-trivial. Elle est la plus légère, quasi zéro-dép, et son seul défaut (raw HTML) est **déjà neutralisé**. Choix cohérent avec `architecture.md`.

Mise en œuvre (`src/lib/export/render-md.ts`) — `renderMarkdown(md, {dir})` :
1. **Pré-passes regex** avant marked (plutôt qu'un renderer custom, dont l'API varie selon les versions) : wikilinks `[[cible]]` → texte brut (inertes en PDF) ; URLs d'images résolues (`resolveLocalImagePath` + `convertFileSrc` → `asset://`, miroir de `live-preview::imageSrc`).
2. `marked.parse(pre, { gfm: true })`.
3. `sanitizeHtml` (DOMPurify) sur la sortie.

## Consequences

**Positives** : `.md` s'exporte en HTML sémantique fidèle (titres, gras/italique, listes, **tableaux GFM**, code, **cases à cocher**, citations, hr, liens, images locales) ; réutilisable par 10.3 (export HTML autonome). Sécurité inchangée (triple défense).

**Négatives / limites** (à traiter en 10.3+) :
- **Pas de coloration syntaxique** des blocs de code (monospace nu ; la coloration live-preview vient des parseurs CM, non rejoués ici).
- **Liens inertes** : `sanitizeHtml` retire le href externe (hook anti-beacon du sandbox) → le texte reste, le lien n'est pas cliquable. Cohérent sécurité ; à revisiter si des liens cliquables dans le PDF sont souhaités.
- **Wikilinks** rendus en texte simple (pas de navigation dans un PDF).
- **Images** : résolues en `asset://` (visibles dans le PDF in-app) ; l'inlining `data:` pour un HTML **portable** est le travail de 10.3.

## Related

- [ADR-0008](./0008-pipeline-export-pdf-window-print.md) — pipeline d'impression (renvoyait le rendu MD à 10.2).
- [ADR-0007](./0007-recherche-index-memoire.md) — précédent « pas de lib tierce » (contexte opposé assumé).
- `docs/planning/architecture.md` (marked + DOMPurify planifié) · `docs/planning/PRD-v1.5.md` (FR-2) · story 10.3 (HTML autonome).
- marked : https://marked.js.org/
