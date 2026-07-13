# 0011. Lecture PDF : PDF.js (canvas, worker Vite, offline)

Date : 2026-07-13 · Status : accepted · Deciders : Kubo · Tags : pdf, viewer, csp, arm64, fr-3

## Context

Le PRD-v1.5 (FR-3, P1) demande d'**ouvrir et lire un PDF en lecture seule** dans un onglet Doku, **100 % hors-ligne**. Contraintes : ESM/Vite, **arch-agnostique** (Windows ARM64, aucun binaire natif), **zéro réseau au runtime** (8.3), CSP stricte. Doku n'avait aucun rendu PDF ; `object-src 'none'` interdit d'ailleurs un `<embed>`/`<object>` PDF natif.

## Decision drivers

- Lecture seule fidèle, multi-pages, offline.
- Pur JS/WASM (ARM64, pas de binaire).
- Sécurité : un PDF est un format **actif** (JS embarqué, annotations `/URI`) → aucun vecteur phone-home.
- CSP minimale (leçon AGENTS : éviter `default-src`/`script-src`, risque de casser IPC/asset).

## Considered options

- **PDF.js (`pdfjs-dist`)** — moteur Mozilla, rendu `<canvas>`, pur JS + WASM optionnel. ESM, offline.
- **`<embed>`/`<object>` PDF natif WebView2** — bloqué par `object-src 'none'` + dépend du moteur PDF de l'OS (fidélité/contrôle nuls, pas offline garanti).
- **PDFium (binaire ARM64)** — natif, mais réintroduit du Rust/binaire (contra ADR-0004) pour un besoin lecture-seule.

## Decision

**PDF.js (`pdfjs-dist` v6) retenu**, rendu `<canvas>`, lecture seule. Points de mise en œuvre (`src/lib/pdf.ts` + `src/components/PdfView.svelte`) :

- **Octets via `data: Uint8Array`** (`readFileBytes` → plugin-fs `readFile`, permission `fs:allow-read-file` déjà en place) — PDF.js n'émet **aucune** requête range/fetch → `connect-src 'self'` garantit le zéro-réseau (8.3).
- **Worker** chargé via l'import **`?worker` de Vite** (`pdf.worker.min.mjs?worker` → `GlobalWorkerOptions.workerPort`) : asset local hashé, chunk séparé, aucun CDN. CSP : **ajout de `worker-src 'self' blob:`** uniquement (le rendu est sur canvas — pas de touche à img/object/script).
- **Sécurité lecture seule** : rendu **canvas seul**, `enableXfa:false`, **aucune couche scripting/annotation montée** → le JS embarqué du PDF n'est jamais exécuté (pdfjs v6 n'exécute le scripting que via un ScriptingManager câblé), pas de vecteur `/URI`. `disableFontFace:true` → glyphes en tracés canvas (pas de `font-src`). La CSP sans `script-src` n'impose pas `unsafe-eval` (pdfjs v6 a retiré l'option `isEvalSupported` ; revalider si `script-src` est durci).
- **Perf** : rendu **paresseux** page-par-page (IntersectionObserver) → 1re page rapide, jamais tout le document d'un coup.
- **Lazy-load** : `pdf.ts` (PDF.js ~1,3 Mo) importé dynamiquement → hors bundle principal.
- **Intégration document** : nouveau `kind: 'pdf'` ; ouverture **sans lecture texte** (sinon `detectUnsupported` rejetterait le binaire) ; **`saveTab` garde `if kind==='pdf' return`** (un Ctrl+S écrirait `content=''` et **détruirait** le PDF) ; `restoreSession` rouvre les onglets pdf sans lecture texte ; `.pdf` **exclu de l'index de recherche**.

## Consequences

**Positives** : lecture PDF offline, pur JS/WASM (ARM64), zéro réseau, CSP quasi inchangée (une directive), aucun Rust ajouté, sécurité (pas de scripting/annotations).

**Négatives / limites** (→ reste de 11.1) :
- **CMaps (CJK)** et **décodeurs WASM (JPEG2000/JBIG2)** non bundlés → ces PDF dégradent (glyphes/images vides). Bundling `cmaps/` + `standard_fonts/` + wasm (servis en `self`, fetch autorisé par `connect-src 'self'`) = suite.
- Pas de **zoom** ni de **recherche in-PDF** (spike = fit-width, lecture) — polissage 11.1.
- Les **polices non-embarquées** (standard 14) peuvent manquer sans `standardFontDataUrl` (idem bundling).

## Validation

Le worker + la CSP **ne s'appliquent qu'en natif** (leçon AGENTS) → **essai NATIF requis** : `tauri dev` → Ctrl+O un vrai `.pdf` (polices embarquées) → rendu lecture seule, scroll multi-pages, worker chargé offline (0 « fake worker », 0 violation CSP/eval en console), 1re page < 1 s. Tester aussi un PDF **CJK** (dégradé attendu = confirme la limite CMap). Ledger 11.1 reste `passes:false` jusque-là.

## Related

- [ADR-0004](./0004-io-fichiers-plugins-officiels.md) (zéro Rust — écarte PDFium) · [ADR-0005](./0005-scope-fs-large-assume.md).
- `docs/planning/PRD-v1.5.md` (FR-3) · `docs/sprints/sprint-10.md` (Epic 11) · story 11.2 (`.pdf` associations).
- PDF.js : https://mozilla.github.io/pdf.js/
