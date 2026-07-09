# Sprint 2

**Goal** : Doku devient l'app qu'on double-clique et dans laquelle on navigue — instance unique, vrai explorateur de dossier, session restaurée, contenu sûr.
**Start** : 2026-07-09
**End** : 2026-07-16
**Status** : Active

## Stories

| # | Story | Size | Priority | Status | Notes |
|---|-------|------|----------|--------|-------|
| 2.3 | Instance unique + double-clic/association de fichiers | M | P0 | TODO | plugin single-instance déjà présent ; ajouter `fileAssociations` NSIS + ouverture par argument/CLI ; smoke tests natifs tôt |
| 1.4 | Sanitization du HTML inline (allowlist) | S | P0 | TODO | pipeline type `sanitize.ts` de KUDE (marked + DOMPurify allowlist) pour le HTML issu du contenu |
| 4.1 | Explorateur de dossier réel (remplace la démo) | M | P1 | TODO | scan du dossier du doc actif ; tri dossiers puis fichiers ; clic → onglet ; nouvelle permission `fs:read-dir` |
| 4.2 | État sidebar persistant (masquée par défaut) | S | P1 | TODO | persister `sidebarOpen`/`sidebarView` (settings.json) ; masquée au 1er lancement natif |
| 2.5 | Restauration de session (onglets + actif) | M | P1 | TODO | `session.json` debouncé ; fichier disparu → signalé puis retiré |

## Blockers
_None_

## Progress Log
### 2026-07-09
- Sprint initialisé avec 5 stories (2 P0, 3 P1) — thème « app par défaut + navigation quotidienne »
- Hors périmètre volontaire : 1.3 (rendu GFM) reporté avec 3.7 (widgets tableaux/images, L) dans un futur sprint « éditeur riche »
- Rappel process (rétro S1) : itérations design/logo **hors stories** ; smoke tests natifs **tôt** (surtout 2.3)
