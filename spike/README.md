# Spike S0 — moteur WYSIWYG Markdown

**But** (défini dans `docs/planning/architecture.md`) : départager les deux candidats pour le `MarkdownEditor` de Doku (FR-3, édition à la Typora) et produire l'ADR-0002.

| | A — Milkdown (ProseMirror) | B — CodeMirror 6 « live preview » |
|---|---|---|
| Modèle | markdown → doc ProseMirror → markdown (sérialisation remark) | le buffer **est** le markdown, décorations par-dessus |

## Protocole

`npm install` puis `npm run dev` — deux pages : `/a-milkdown.html`, `/b-cm6.html`.

1. **Round-trip** (bouton) : chaque fichier de `corpus/` (7 vrais documents du projet + 1 fichier piège) est chargé puis re-sérialisé sans aucune édition ; on compare octet pour octet, diff ligne à ligne sinon.
2. **500 Ko** (bouton) : chargement chronométré de `09-stress-500k.md` (5 378 blocs variés).
3. **Frappe** (bouton) : 80 caractères insérés un par frame, on mesure l'écart moyen / p95 / max entre frames.
4. **Faisabilité** : checkbox de tâches cliquables et wikilinks `[[…]]` cliquables, vérifiés à la main dans les deux prototypes.

## Résultats (run du 2026-07-08, Surface Pro 11 / Snapdragon X Elite, Chrome via Playwright)

| Critère | A — Milkdown 7.21 | B — CM6 live preview (plugin spike) |
|---|---|---|
| Round-trip corpus (8 fichiers, zéro édition) | **0/8 identiques** — 9 à 176 lignes de diff par fichier (tables re-paddées, `_it_`→`*it*`, `\[` échappés, lignes vides) | **8/8 identiques octet pour octet** (par construction) |
| Chargement 500 Ko + premier rendu | 1 727 ms | **27 ms** |
| Frappe sur 500 Ko (par frame) | avg **68,7 ms** · p95 80,3 · max 85,5 (~15 fps) | avg **17,3 ms** · p95 27,1 · max 40,5 |
| Frappe sur document normal | avg 16,6 ms ✓ | équivalent ✓ |
| Checkbox cliquable | modèle `data-checked` présent, UI headless à styler/brancher | **démontré** : widget `<input>`, le clic réécrit `[ ]`↔`[x]` dans la source |
| Wikilink `[[…]]` | texte brut — plugin remark à écrire (~½ j) | **démontré** : décoré, cliquable, cible résolue |
| Masquage de syntaxe hors ligne active | n/a (WYSIWYG pur — la syntaxe n'existe plus) | **démontré** : `#`, `**`, `` ` ``, marqueurs de liens masqués, révélés sur la ligne active |

**Verdict : CodeMirror 6 live preview** — voir `docs/adr/0002-moteur-wysiwyg-cm6-live-preview.md`. Le comportement spécifié par FR-3 (« syntaxe du bloc courant visible pendant l'édition ») *est* le modèle live-preview ; Milkdown le contredit deux fois (round-trip destructif, perf).

## Spikes M0/M2 — bureau scindé (2026-08-13)

`/split-workspace.html` monte deux instances indépendantes de CodeMirror avec le document de stress de 500 Ko et la couche live-preview. Le bouton exécute 80 frappes dans le volet principal et vérifie que le second buffer reste strictement inchangé.

- **PASS** si le volet secondaire est inchangé, le volet principal a reçu les frappes et le p95 reste ≤ 50 ms.
- **FAIL** sinon : le bureau scindé doit basculer le volet secondaire en lecture seule ou revoir la cible de performance avant implémentation.
- La cible produit p95 ≤ 16 ms reste plus stricte ; le seuil de 50 ms du spike est uniquement le kill-test contre les gels perceptibles.

Résultat mesuré le 2026-08-13 dans Chromium sur la machine ARM64 de référence :

| Mesure | Résultat |
|---|---|
| Montage + premier rendu des deux documents de 500 Ko | **73,9 ms** |
| Frappe 80 caractères dans le volet principal | avg **19,2 ms** · p95 **29,5 ms** · max **37,4 ms** |
| Buffer secondaire après la frappe | **strictement inchangé** |
| Breakpoint 700 × 720 | colonne, deux surfaces **676 × 280 px** |
| Verdict kill-test | **PASS** |

Le checkpoint M2 ajoute un garde-fou produit : lorsque le bureau est scindé, un document d’au moins 450 000 caractères conserve son buffer CodeMirror éditable mais suspend temporairement les décorations live-preview. La vue propre revient automatiquement à la réunification.

Mesure M2, cinq passages dans Chromium après montage :

| Mesure | Résultat |
|---|---|
| Frappe 80 caractères, p95 | **18,6 à 20,0 ms** |
| Maximum observé | **27,3 ms** |
| Buffer secondaire | **strictement inchangé sur 5/5 passages** |
| Checkpoint produit p95 ≤ 25 ms, max < 50 ms | **PASS** |

Limite explicite : cette mesure valide l’interaction lourde du bureau scindé sur la machine ARM64 de référence. Elle ne remplace pas un profilage de documents dépassant nettement le corpus de 500 Ko.

## Notes de périmètre

Le plugin `src/live-preview.ts` (candidat B) a été écrit pour ce spike (~170 lignes) : titres, gras/italique/barré, code inline + fences, liens, citations, checkbox-widgets, wikilinks — sélection-aware, limité au viewport. **Hors périmètre spike** et compté comme effort restant dans l'ADR : tableaux (le point dur documenté), images inline, `atomicRanges` (saut de curseur), copier-coller/IME polish.

## Spike — sélection PDF non destructive (2026-08-14)

`/spike/pdf-text-selection.html` superpose la `TextLayer` PDF.js au canvas HiDPI et transforme une sélection DOM en texte + rectangles normalisés. Il charge par défaut `spike/fixtures/pdf-annotation-test.pdf` et accepte un PDF local via le sélecteur de fichier.

Depuis `spike/`, lancer `npm run dev -- --port 1421 --host 127.0.0.1`, puis ouvrir `/pdf-text-selection.html`. Le paramètre `?dpr=1`, `?dpr=1.25` ou `?dpr=1.5` force le backing store du canvas pour reproduire la matrice de mise à l’échelle sans modifier Windows.

Le kill-test automatique exige, pour chaque page du corpus synthétique tournée à 0°, 90°, 180° et 270°, une sélection textuelle non vide, au moins un rectangle, des coordonnées entièrement contenues dans la page, un écart CSS canvas/TextLayer/page inférieur ou égal à 2 px et un backing store conforme au DPR demandé. La matrice DPR 1/1,25/1,5 passe avec un écart maximal mesuré de 0,62 px ; le DPR Windows actif de 1,75 passe également avec 0,94 px. Un geste réel de sélection dans WebView2 reste requis avant l’intégration dans `PdfView.svelte`.
