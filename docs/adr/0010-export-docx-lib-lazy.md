# 0010. Export DOCX : lib `docx` (lazy-loadée, marked.lexer → OOXML)

Date : 2026-07-13 · Status : accepted · Deciders : Kubo · Tags : export, docx, ooxml, fr-5

## Context

Le PRD-v1.5 (FR-5, **P2 stretch**) demande un export **DOCX** ouvrable dans Word, à fidélité *raisonnable* (titres, gras/italique, listes, liens, tableaux, code), les éléments non mappables retombant en texte brut **sans planter**. Contraintes : **100 % hors-ligne**, ESM/Vite, **arch-agnostique** (JS pur — Windows ARM64). OOXML (.docx) est un format zip+XML complexe : le générer à la main n'est pas envisageable.

## Decision drivers

- Fidélité raisonnable des blocs courants, jamais de crash.
- Offline / ARM64 / Vite (pur JS, pas de binaire).
- Coût bundle maîtrisé (feature **stretch** — ne doit pas alourdir le démarrage).
- Réutiliser le parseur déjà présent (`marked`, ADR-0009).

## Considered options

- **`docx` (dolanmiu)** — lib OOXML déclarative. ESM natif, pur JS, 4 deps pur-JS (jszip/xml-js/nanoid/hash.js), ~100 Ko gzip. API `Document/Paragraph/TextRun/Table/…`, sérialisation navigateur via `Packer.toBlob`.
- **`html-docx-js`** — convertit du HTML→docx. Plus simple mais ancien/peu maintenu, fidélité et contrôle moindres.
- **Génération OOXML maison** — rejeté (zip+XML, des jours de travail pour un stretch).

## Decision

**`docx` retenu**, alimenté par les **tokens `marked.lexer`** (pas le HTML) : un walker récursif mappe headings/emphase/listes/liens/tableaux/code fence en modèle docx ; **tout token non mappable → `TextRun` texte brut** (chaque `switch` a un `default`), ce qui garantit le « sans planter » du verify.

Deux points d'implémentation :
- **Lazy-load** : `docx` (~100 Ko) est chargé par **import dynamique au clic** (`import('../lib/export/docx')` dans DocumentView) → hors bundle principal (même esprit que les plugins Tauri chargés dynamiquement). Le démarrage n'est pas alourdi par un stretch.
- **`Packer.toBlob`** (pas `toBuffer`, qui dépend de `Buffer` Node → friction Vite) → `Uint8Array` → `writeFile` binaire (permission **`fs:allow-write-file`** ajoutée, scope `**` cohérent ADR-0005).

## Consequences

**Positives** : export DOCX fonctionnel réutilisant `marked` ; pur JS/offline/ARM64 ; coût bundle isolé (chargé à la demande) ; robuste (fallback texte systématique).

**Négatives / limites assumées** (stretch) :
- **Listes ordonnées** rendues avec un préfixe `1.` manuel (évite la config `numbering` Word — fidélité raisonnable, pas de numérotation native).
- **Images** markdown → texte alternatif (pas d'image binaire embarquée).
- **Imbrication de listes** best-effort ; **coloration** de code absente (police monospace nue).
- +100 Ko gzip (isolés hors bundle principal) + 4 dépendances transitives pur-JS.

## Validation

Fidélité et ouvrabilité **exigent un essai natif** : `.md` → « Exporter en DOCX » → ouvrir le `.docx` dans **Word/LibreOffice**. Le ledger 10.4 reste `passes:false` jusque-là.

## Related

- [ADR-0009](./0009-renderer-markdown-marked.md) — `marked` (réutilisé ici via `marked.lexer`).
- [ADR-0008](./0008-pipeline-export-pdf-window-print.md) · [ADR-0005](./0005-scope-fs-large-assume.md) (scope fs `**`).
- `docs/planning/PRD-v1.5.md` (FR-5) · `docs/sprints/sprint-9.md` (Epic 10).
- docx : https://docx.js.org/
