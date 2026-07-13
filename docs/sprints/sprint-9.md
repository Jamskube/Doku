# Sprint 9

**Goal** : Exporter un document hors de Doku — **PDF** (fidèle au rendu) + **HTML autonome**, DOCX en bonus.
**Start** : 2026-07-13
**End** : 2026-07-20
**Status** : Active

Deuxième sprint du cap v1.5 (source : `docs/planning/PRD-v1.5.md`, Epic 10). Périmètre = Epic 10 (Export). À la clôture, « Exporter → PDF / HTML » marche de bout en bout. Lecture PDF (Epic 11) + coller image (Epic 12) = Sprint 10.

## Stories

| # | Story | Size | Status | Notes |
|---|---|---|---|---|
| 10.1 | Spike : pipeline export PDF (`window.print` vs `PrintToPdfAsync`) | S | TODO | **En tête** : essai natif ARM64 → tranche dialogue vs COM. Piège WebView2 **#5199** (PDF supprimé si webview disposée trop tôt). Note/ADR |
| 10.2 | Export PDF (feuille `@media print`, fidèle WYSIWYG) | M | TODO | Chrome masqué, sauts de page `break-inside: avoid`, marges. **Non testable en dev navigateur pur** → smoke natif |
| 10.3 | Export HTML autonome (styles + images inline, sanitizé) | M | TODO | Un seul `.html`, styles AIR inline, images `data:`, `sanitizeHtml` (pas de script). Réutiliser `html.ts` / `sanitizeHtml` |
| 10.4 | Export DOCX (lib OOXML JS) — **stretch** | M | TODO | Lib `docx` (JS, arch-agnostique). Fidélité raisonnable. **Coupable en premier** si le sprint déborde |

## Blockers
_None_

## Progress Log
### 2026-07-13
- Sprint initialisé avec 4 stories (Epic 10 Export). 3 cœur (10.1-10.3) + 1 stretch (10.4). Vélocité cible ~4 (cohérent S6=4 / S7=3 / S8=4).
- Risque principal (pipeline PDF WebView2 ARM64, piège #5199) **absorbé par le spike 10.1** en tête.
- Rappel : l'impression WebView2 (≠ Chromium navigateur) et le rendu print ne se vérifient qu'**en natif** (comme la CSP) → smoke natif requis pour 10.2.
- Après ce sprint : Sprint 10 = Lecture PDF (Epic 11) + coller image (Epic 12).

- **10.3 — Export HTML autonome** : un seul `.html` portable (images inlinées **data:** base64, styles inline paperCss, **CSP portable** `default-src none; img-src data:`, sanitize). `standalone.ts` (`collectLocalImages`/`buildStandaloneHtml`/`exportStandaloneHtml` DI) + `img-data.ts` (mime/base64 chunké, module séparé pour casser le cycle `tauri→standalone→render-md→tauri`) ; `render-md` paramétré par `resolveImage` (asset:// PDF vs data: standalone) ; `tauri.ts` `readImageDataUrl`+`saveHtmlDialog` ; capability **+`fs:allow-read-file`** (lecture binaire) ; 2e bouton doc-head. **Corrections critic** : inlining unifié `.md` **et** `.html` (DOM-walk pré-sanitize — DOMPurify garde les src relatifs → sinon fichier « autonome » cassé), **CSP réintroduite** (seul output hors sandbox), garde taille/échecs (`console.warn`, jamais de cap silencieux). 12 tests. **10.3 `passes:false`** : attend la validation NATIVE (fichier ouvert hors-ligne dans un vrai navigateur, image inline visible).
- **10.1 spike — scaffold + décision (ADR-0008)** : tranché **`window.print()` + `@media print` (iframe isolé)** vs `PrintToPdf` COM. A==B en fidélité (même moteur Chromium) ; A retenu car B exige du Rust/COM (**viole ADR-0004**) pour un besoin batch inexistant (YAGNI). Scaffold livré : bouton « Exporter en PDF » (`.doc-head`), `src/lib/export/print.ts` (`buildPrintHtml` + `exportViaPrint`), refactor `html.ts` (`paperCss`/`injectHead` réutilisables). **Corrections critic** : iframe `sandbox="allow-modals allow-same-origin"` (sans allow-scripts) + CSP `default-src none` injectée (défense en profondeur) ; renderMarkdown **sorti du spike** (l'app n'a aucun renderer md → testerait une fidélité factice) → `.html`/`.txt`/`.md` seulement, rendu MD→HTML reporté en 10.2 ; teardown iframe **différé** (#5199, jamais synchrone). 5 tests `print.test.ts`. **10.1 `passes:true`** — validé en natif par l'utilisateur (export « Exporter en PDF » → dialogue → « Enregistrer au format PDF » fonctionne). À confirmer en 10.2 : persistance du PDF après fermeture app (#5199) + rendu MD fidèle.
