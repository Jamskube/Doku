# 0008. Pipeline d'export PDF : `window.print()` + `@media print` (iframe isolé)

Date : 2026-07-13 · Status : accepted · Deciders : Kubo · Tags : export, pdf, webview2, arm64, fr-2

## Context

Le cap v1.5 (PRD-v1.5, FR-2) demande d'exporter un document hors de Doku en **PDF fidèle au rendu**, 100 % hors-ligne. Doku tourne dans **WebView2 sur Windows ARM64** (Snapdragon X Elite). Deux mécaniques d'impression PDF sont disponibles ; le spike 10.1 doit trancher avant de coder l'export (10.2).

Contraintes structurantes :
- **ADR-0004** : hôte Rust minimal, **zéro logique métier en Rust**, tout I/O via plugins JS.
- **8.3** : zéro requête réseau au runtime (l'export doit rester local).
- L'app n'a **aucun renderer Markdown→HTML** aujourd'hui (la live-preview CodeMirror décore du markdown brut, DOM virtualisé partiel — inexploitable pour l'impression). Le seul rendu HTML fidèle existant est celui des fichiers `.html` (`html.ts::sandboxDoc`, assaini + feuille papier AIR).

## Decision drivers

- Fidélité « au rendu » (WYSIWYG papier).
- Alignement ADR-0004 (ne pas réintroduire de logique Rust/COM).
- Testabilité (idéalement vérifiable en dev navigateur, pas seulement en natif).
- Hors-ligne strict, aucune dépendance ajoutée si évitable.
- Robustesse face au piège WebView2 **#5199**.

## Considered options

### Option A : `window.print()` + `@media print` (dialogue)
Rendre le document dans un iframe isolé, appeler `iframe.contentWindow.print()` → dialogue d'impression Chromium de WebView2, destination « Enregistrer au format PDF ».
- **Pros** : zéro dépendance, **zéro Rust** (pur DOM/JS), même moteur d'impression Chromium → fidélité maximale ; l'utilisateur choisit l'emplacement et peut prévisualiser ; testable partiellement en dev.
- **Cons** : passe par un dialogue (pas de flux silencieux/batch) ; les **marges** et les **en-têtes/pieds de page** du navigateur ne sont **pas** contrôlables par CSS (`@page{margin}` n'est qu'un défaut, l'utilisateur peut l'écraser dans le dialogue) ; concerné par **#5199** (le PDF « Save as PDF » peut être supprimé si la webview est disposée avant la fin de l'écriture async).

### Option B : `ICoreWebView2_7::PrintToPdf` (COM, silencieux)
Appeler l'API COM WebView2 depuis Rust via `with_webview()` + crates `webview2-com`/`windows`, écriture directe vers un chemin choisi, sans dialogue.
- **Pros** : silencieux/déterministe, contrôle total des marges/orientation via `ICoreWebView2PrintSettings`, adapté au batch/headless.
- **Cons** : **exige de la logique Rust/COM `unsafe`** → **viole ADR-0004** ; non testable en dev navigateur (natif only) ; concerné aussi par #5199 si dispose avant le completed handler (mais contrôlable).

## Decision

**Option A retenue.** Sur le critère « fidèle au rendu », A et B sont **équivalents** (même moteur Chromium/WebView2, même HTML → même PDF). B ne gagne que sur le **non-interactif/batch**, un besoin **inexistant** pour un lecteur/éditeur perso interactif (**YAGNI**), et son coût est une **violation d'ADR-0004** (Rust/COM). A est donc l'arbitrage aligné à la fois sur l'architecture (zéro Rust) et sur l'usage (l'utilisateur veut choisir où enregistrer et prévisualiser). B reste le **repli documenté** si un export non-interactif devient un jour nécessaire.

Mise en œuvre (`src/lib/export/print.ts`) :
- Rendu dans un **iframe isolé** `sandbox="allow-modals allow-same-origin"` (**sans `allow-scripts`**) : `allow-same-origin` permet au parent d'appeler `contentWindow.print()`, `allow-modals` autorise le dialogue, l'absence de `allow-scripts` neutralise tout script injecté **même si DOMPurify est contourné** sur un `.html` non fiable (défense en profondeur).
- **CSP `default-src 'none'` injectée** dans le doc d'impression (ne pas dépendre de l'absence de `style-src` dans la CSP applicative, susceptible d'être durcie).
- Corps : `.html` → `sanitizeHtml` (chemin fidèle existant) ; `.txt`/`.md` → `<pre>` échappé (le **rendu MD→HTML fidèle est la story 10.2** — l'app n'ayant aucun renderer md, le spike ne mesure PAS une fidélité md pour ne pas tester un chemin qui n'est pas l'affichage réel).
- **#5199** : ne jamais fermer la fenêtre pendant l'impression ; **teardown de l'iframe différé** (jamais synchrone pendant l'écriture async), sur `afterprint` + repli temporisé.

## Consequences

**Positives** : export PDF sans dépendance ni Rust ; fidélité maximale (moteur Chromium) ; posture de sécurité préservée (iframe sandboxé + CSP + DOMPurify = 3 couches, comme l'aperçu `.html`) ; testable en dev pour le chemin UI.

**Négatives / limites connues** (à porter à l'utilisateur / adresser en 10.2) :
- Marges et **en-têtes/pieds de page** du dialogue non pilotables par CSS (coût inhérent à A).
- **Polices bundlées** (@fontsource) : l'iframe est un document séparé, les `@font-face` du parent n'y cascadent pas → repli serif système (Georgia). Pour une fidélité de police il faudra inliner les `@font-face` (data:) en 10.2.
- **Images relatives / `asset:`** non résolues dans le doc d'impression (mêmes limites que l'aperçu sandboxé, `img-src data:`). À traiter en 10.2/10.3.
- Rendu **MD** = source brute tant que 10.2 n'a pas ajouté le renderer MD→HTML.

**Risques → mitigation** :
- #5199 (PDF supprimé) → ne pas disposer la webview pendant l'impression + teardown iframe différé. **À confirmer en natif** (timing exact du teardown, fiabilité d'`afterprint` sur destination « PDF » virtuelle).

## Validation

La décision « fidélité + UX » **exige un essai NATIF ARM64** (le moteur d'impression WebView2 ≠ navigateur dev, comme la CSP) : `npm run tauri dev` → ouvrir un `.html` (chemin fidèle) → « Exporter en PDF » → « Enregistrer au format PDF » → vérifier fidélité (sauts de page, marges), puis **fermer l'app et confirmer que le PDF persiste** (#5199). Le ledger 10.1 reste `passes:false` jusqu'à cette validation.

## Related

- [ADR-0004](./0004-io-fichiers-plugins-officiels.md) — zéro commande Rust custom (raison n°1 d'écarter B).
- [ADR-0005](./0005-scope-fs-large-assume.md) — scope fs/asset.
- `docs/planning/PRD-v1.5.md` (FR-2) · `docs/sprints/sprint-9.md` (Epic 10) · story 10.2 (export PDF fidèle).
- WebView2 #5199 : https://github.com/MicrosoftEdge/WebView2Feedback/issues/5199
