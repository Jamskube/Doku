# Sprint 2

**Goal** : Doku devient l'app qu'on double-clique et dans laquelle on navigue — instance unique, vrai explorateur de dossier, session restaurée, contenu sûr.
**Start** : 2026-07-09
**End** : 2026-07-16
**Status** : Active

## Stories

| # | Story | Size | Priority | Status | Notes |
|---|-------|------|----------|--------|-------|
| 2.3 | Instance unique + double-clic/association de fichiers | M | P0 | TODO | plugin single-instance déjà présent ; ajouter `fileAssociations` NSIS + ouverture par argument/CLI ; smoke tests natifs tôt |
| 1.4 | Sanitization du HTML inline (allowlist) | S | P0 | ✅ Done | Chemin markdown (CM6) sûr par construction (HTML = texte, non exécuté) ; primitive `sanitizeHtml` (DOMPurify) + 6 tests, prête pour la vue HTML (FR-8) |
| 4.1 | Explorateur de dossier réel (remplace la démo) | M | P1 | ✅ Done | Listing/tri/filtre/navigation + clic→onglet ; 14 tests unitaires ; scan de vrai dossier validé en natif |
| 4.2 | État sidebar persistant (masquée par défaut) | S | P1 | ✅ Done | Couche settings `loadSettings`/`saveSettings` (localStorage `doku-settings`) ; défaut masquée ; persistance validée Playwright (reload) |
| 2.5 | Restauration de session (onglets + actif) | M | P1 | TODO | `session.json` debouncé ; fichier disparu → signalé puis retiré |

## Blockers
_None_

## Progress Log
### 2026-07-09
- Sprint initialisé avec 5 stories (2 P0, 3 P1) — thème « app par défaut + navigation quotidienne »
- Hors périmètre volontaire : 1.3 (rendu GFM) reporté avec 3.7 (widgets tableaux/images, L) dans un futur sprint « éditeur riche »
- Rappel process (rétro S1) : itérations design/logo **hors stories** ; smoke tests natifs **tôt** (surtout 2.3)

### 2026-07-09 — 4.1
- **1.4** ✅ **Done** : découverte — l'app ne rend **aucun HTML de contenu** (WYSIWYG = texte CodeMirror en contenteditable), donc un `<script>` inline s'affiche en texte et n'exécute rien (vérifié Playwright : `window.__xss` reste `undefined`). Livré quand même la primitive `sanitizeHtml` (DOMPurify allowlist : retire script/`on*`/`javascript:`/iframe, garde le HTML sûr — 6 tests jsdom), prête pour le consommateur réel = la vue HTML (FR-8). happy-dom écarté (incompatible DOMPurify) au profit de jsdom.
- **4.2** ✅ **Done** : couche de persistance `settings` (localStorage `doku-settings`) via `loadSettings` (à l'import) + `saveSettings` (un unique `$effect` dans App qui suit thème/sidebar). Défaut `sidebarOpen=false` (app légère, FR-6). Validé Playwright : défaut masquée, ouvrir→reload reste ouverte, fermer→reload reste fermée. **Réutilisable par 6.1 (thème) / 6.2 (largeur) ; 2.5 (session) suivra un fichier séparé.**
- **4.1** → Review : sidebar Fichiers = vrai listing (`readDirectory` plugin-fs, permission `fs:allow-read-dir` ajoutée) ; helpers purs `explorer.ts` (`sortEntries` dossiers-puis-fichiers, `visibleEntries` filtre extensions, `parentPath`/`joinPath`/`baseName`) + 14 tests. Navigation dans les sous-dossiers + `..`, clic fichier → `openPath` (lit + ouvre l'onglet, resync `explorerDir`). Mode navigateur : `DEMO_DIR` pour visualiser l'UI. Validé Playwright : tri, filtre `image.png`, nav Projets/.., clic idées.md → onglet actif + surlignage. Reste : scan d'un vrai dossier en natif.
