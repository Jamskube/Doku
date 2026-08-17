# Plan: nettoyage-backend

_Date: 2026-08-17 · Estimated scope: L_

## Goal

Retirer le code mort du backend de Doku, corriger trois fonctions utilitaires dont on a prouvé qu'elles sont fausses sur des cas réels, faire converger les réimplémentations en ligne vers ces fonctions corrigées, et réduire la surface publique de `src/lib/**`. Aucun comportement visible ne doit changer — sauf là où le comportement actuel est un bug démontré, auquel cas le plan le dit explicitement.

Le déclencheur : la suppression de la conversion PDF → DOCX a laissé des vestiges, et l'audit qui a suivi a montré que le problème était plus ancien et plus large — deux implémentations de la sauvegarde dont une morte, neuf copies d'un `basename` maison, trois extracteurs d'extension dont deux faux.

## Out of scope

- **Toute optimisation de poids de bundle.** Mesuré : 1 017 Ko au démarrage, 30,4 Mo à la demande, ni SuperDoc ni MuPDF ni pdf.js au boot ; les ~480 Ko tiers sont CodeMirror, cœur de l'éditeur. Il n'y a pas de gras à retirer. Inventer une optimisation ici serait de la décoration.
- **Le worker `collaboration-worker-entry` (4,6 Mo).** Son nom ment : c'est le moteur d'édition DOCX (`superdoc-v2-edit`), vérifié en instrumentant le constructeur `Worker`. Ne pas y toucher.
- Le frontend (`src/components/**`) — traité ensuite, séparément, via `impeccable`.
- Le numéro de version, les installateurs, toute montée de dépendance qui changerait le rendu.

## Files

### Modified

**Étape 1 — corriger ce qui est faux (aucune suppression)**

- `src/lib/explorer.ts` — `baseName` gère les DEUX séparateurs. Preuve du défaut : sur `C:\Docs/note.md` (chemin mixte, courant sous Tauri) elle rend `Docs/note.md`. Mais la version en ligne recopiée ailleurs est fausse aussi, sur un autre cas : sur `C:\Docs\` elle rend `''` là où l'actuelle rend `Docs`. La version corrigée doit traiter les deux : séparateur final retiré, puis découpe sur `[\\/]`.
- `src/lib/explorer.ts` — `isSupportedFile` passe par `extensionOf` au lieu de `split('.').pop()`. Défaut prouvé : un fichier nommé exactement `md` (sans point) est aujourd'hui déclaré supporté.
- `src/lib/doc-kind.ts` — `kindFromName` passe par `extensionOf`. Défaut prouvé et plus grave : un fichier nommé exactement `pdf` est classé `kind: 'pdf'`, donc traité comme un binaire et rendu par le lecteur PDF. `extensionOf` doit donc quitter `explorer.ts` pour `doc-kind.ts` (module pur, sans dépendance) afin d'éviter un cycle `doc-kind → explorer → doc-kind`.
- `src/lib/explorer.ts` — réimporte `extensionOf` depuis `doc-kind.ts` (ou le réexporte pour ne pas casser `sortEntries`).
- `src/lib/tabs.ts` — `parentFolder` réécrit en `baseName(parentPath(p))`, une seule stratégie de séparateur au lieu de deux incompatibles.

**Étape 2 — converger les doublons vers les fonctions corrigées**

- `src/lib/save-as.ts` (lignes 49, 64), `src/lib/tauri.ts` (307, 343), `src/lib/wikilink.ts` (7, 31), `src/lib/export/pdf-annotated.ts` (27), `src/lib/copilot-context.ts` (87) — remplacer `path.split(/[\\/]/).pop()` par `baseName(path)`.
- `src/components/DocxView.svelte` (53), `src/components/PdfPagesDialog.svelte` (53, 156), `src/components/PdfTextEditDialog.svelte` (46) — même convergence. Ces quatre-là sont dans les composants mais font partie du MÊME doublon : les traiter ici évite de laisser la moitié du travail au passage frontend.
- `src/lib/copilot-context.ts`, `src/lib/export/standalone.ts` — une constante `MO` partagée au lieu de `1024 * 1024` répété trois fois.

**Étape 3 — réduire la surface publique (dé-exports, aucune suppression de code)**

- `src/lib/tauri.ts` — `saveDocxDialogPath`, `readFolderTexts` deviennent privés.
- `src/lib/save-as.ts` — `fileNameFromPath` privé.
- `src/lib/export/pdf-edit-text.ts` — `pageCodecs` privé.
- `src/lib/pdf-drawing.ts` — `createPdfStrokeDrawing` privé.
- `src/lib/export/docx-to-pdf.ts` — `renderDocxStructureToPdf` privé.
- `src/lib/stores.svelte.ts` — `applyTheme`, `applyColumnWidth`, `restoreSession`, `loadSettings`, `closeTab` privés.
- Constantes internes (`MEMORY_*`, `PDF_BURN_HIGHLIGHT_OPACITY`, `PDF_BURN_TEXT_OPACITY`, `PDF_BURN_NOTE_GAP`, `SNAPSHOT_*`, `HEAVY_THRESHOLD`, `MAX_CONTEXT_ITEM_CHARS`, `RAG_MAX_CHUNKS_PER_FILE`, `MAX_PDF_PLAN_PAGES`, `PDF_DRAWING_MIN_STEP`, `PDF_DRAWING_SMOOTHING`, `GROUNDING_REMINDER`) — dé-exporter **au cas par cas**, en vérifiant d'abord qu'aucun test ne les importe. Un export qui n'existe que pour un test est légitime et reste.

**Étape 4 — supprimer le mort**

- `src/lib/stores.svelte.ts` — supprimer `saveTab` (996), `toggleTheme` (410), `clearSearch` (654).
- `src/lib/editor/reveal.ts` — supprimer `revealScope` (36).
- `src/lib/workspace.ts` — `workspaceHasUniqueTabs` : utilisée uniquement par `workspace.test.ts`. **Ne pas supprimer** — un prédicat testé qui documente un invariant du modèle a sa valeur. Le dé-exporter n'est pas possible (le test l'importe). Laisser tel quel et le noter.
- `src/lib/tabs.ts` — `parentFolder` : idem, gardée car réécrite à l'étape 1 et couverte.

**Étape 5 — Rust**

- `src-tauri/src/sidecar.rs` (105, 122, 173, 189) — remplacer les quatre `.unwrap()` sur Mutex hors tests par une récupération du garde empoisonné (`lock().unwrap_or_else(|e| e.into_inner())`). Un mutex empoisonné ne doit pas faire paniquer l'hôte : le sidecar est un service secondaire, sa défaillance ne doit pas emporter l'application.

**Étape 6 — dépendance de sécurité**

- `package.json` — `dompurify` 3.4.11 → 3.4.13 (avis modéré). DOMPurify est la SEULE barrière entre la sortie du LLM et la webview principale (mémoire AGENTS.md du 2026-07-16) : c'est une correction de sécurité, pas un confort. Correctif de patch, couvert par `sanitize` + `html.test.ts` + le test de non-régression réseau sur charge hostile.
- `undici` (élevé) vient de `jsdom`, dépendance de TEST : ne part jamais dans l'app. À signaler, pas à corriger dans ce plan.

### Deleted

- `.agent/visual/pdf-docx/harness.ts` et `.agent/visual/pdf-docx/harness.html` — le banc importe `src/lib/export/pdf-to-docx`, supprimé aujourd'hui avec la conversion. Banc cassé, sans objet : la conversion qu'il éprouvait n'existe plus.

## Order of operations

1. **Corriger** `baseName`, `extensionOf`/`kindFromName`, `parentFolder` + leurs tests. Rien d'autre ne bouge. Commit.
2. **Converger** les 12 sites de duplication vers les fonctions corrigées. Commit.
3. **Dé-exporter** au cas par cas, en vérifiant les tests à chaque symbole. Commit.
4. **Supprimer** le mort prouvé + le banc orphelin. Commit.
5. **Rust** : les quatre `.unwrap()`. Commit.
6. **dompurify**. Commit.

L'ordre est celui du risque croissant : une correction qui améliore la justesse d'abord, une suppression irréversible en dernier. Chaque étape est committable seule et vérifiable seule.

## Test strategy

- **Étape 1** : nouveaux cas dans `explorer.test.ts` et `doc-kind.test.ts` — `baseName` sur `C:\Docs/note.md`, `/home/u\note.md`, `C:\Docs\`, `note.md` ; `extensionOf`/`kindFromName` sur `README`, `.gitignore`, `note.tar.gz`, `md`, `pdf`, `note.MD`. Ces tests doivent ÉCHOUER avant le correctif — sinon ils ne prouvent rien.
- **Étape 2** : la suite existante suffit (les 12 sites sont couverts indirectement) ; vérifier qu'aucun test ne bouge.
- **Étape 3-4** : `npm run check` est le juge — un dé-export ou une suppression qui casse un appelant est une erreur de type.
- **Étape 5** : `cargo check` (le sidecar n'a pas de test unitaire).
- **Étape 6** : suite complète + relecture du test de charge hostile de `sanitize`.
- **À chaque étape** : `npm run check` (0 erreur), `npm test` (≥ 714), `npm run build` (vert).

## Risks

- **Corriger `baseName` change son comportement sur les chemins mixtes** → c'est l'objectif ; le risque est qu'un appelant dépende du bug. Mitigation : les 9 sites en ligne ont DÉJÀ le comportement corrigé ; ce sont eux la référence de fait. Seuls les appelants de `baseName` changent, et dans le sens juste.
- **`extensionOf` déménage de `explorer.ts` vers `doc-kind.ts`** → risque de cycle d'imports. Mitigation : `doc-kind.ts` est un module pur sans dépendance ; le sens `explorer → doc-kind` est le bon.
- **Dé-exporter un symbole utilisé par un banc `.agent/`** → le banc casse silencieusement (pas couvert par `npm run check`). Mitigation : grep obligatoire sur `.agent/**` avant chaque dé-export, et relance des bancs touchés.
- **Supprimer `saveTab` alors qu'il serait la bonne implémentation** → accepté : `saveTabOrSaveAs` est celle qui tourne en production depuis des mois, `saveTab` n'a aucun appelant.
- **dompurify 3.4.13 change la sanitisation d'un cas légitime** → mitigation : suite complète + test réseau hostile ; retour arrière immédiat si un test bouge.

## Open questions

- ~~**`stopOllama` + commande Rust `stop_ollama` : retirer ou garder ?**~~ **TRANCHÉ le 2026-08-17 par la preuve** : `main.rs:82-90` appelle `state.shutdown()` sur `WindowEvent::Destroyed` — **pas** la commande `stop_ollama`. Celle-ci n'a donc aucun appelant, ni côté TS (son unique enveloppe `stopOllama` est morte) ni côté Rust. Les deux partent ; `state.shutdown()` et le Job Object restent, intacts. Raisonnement d'origine conservé ci-dessous.
- Recommandation argumentée : **retirer les deux**. L'arrêt du sidecar est déjà garanti — et plus solidement — par le Job Object Windows (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, mémoire AGENTS.md du 2026-07-14), qui tue tout l'arbre à la mort du process, y compris au crash. Un arrêt explicite jamais appelé n'ajoute aucune garantie et fait vivre une plomberie inter-langages morte, la plus coûteuse à maintenir honnête. **Condition avant suppression** : vérifier que `stop_ollama` n'est pas invoquée depuis Rust lui-même (fermeture de fenêtre) — si elle l'est, tout garder et ne rien changer.
- Faut-il déplacer `formatBytes` hors de `ollama.ts` (elle sert aussi aux tailles de fichiers de contexte) ? Proposé : oui, vers un module de formatage, mais **hors de ce plan** — c'est un déplacement sans gain de justesse, à faire quand un troisième appelant apparaîtra.

## Rollback

Chaque étape est un commit séparé et indépendant : `git revert <sha>` de l'étape fautive suffit, sans toucher aux autres.
