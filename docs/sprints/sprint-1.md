# Sprint 1

**Goal** : Ouvrir, éditer et sauver de vrais fichiers Markdown en natif — sans jamais perdre de données.
**Start** : 2026-07-09
**End** : 2026-07-16
**Status** : Active

## Stories

| # | Story | Size | Priority | Status | Notes |
|---|-------|------|----------|--------|-------|
| 1.1 | Ouverture réelle via dialogue + I/O natif (Ctrl+O) | S | P0 | ✅ Done | Validé natif 2026-07-09 (Ctrl+O sur vrai `.md`) ; démo gatée `!isTauri` + état vide clair/sombre |
| 3.2 | Sauvegarde atomique + indicateur « modifié » (Ctrl+S) | S | P0 | TODO | 🟡 `writeTextFileAtomic` en place — vérifier tmp+rename en natif |
| 3.4 | Confirmation de fermeture non sauvée (Sauver/Ignorer/Annuler) | S | P0 | TODO | onglet dirty + quit app |
| 2.2 | Nouvel onglet actif + différenciateur d'homonymes | S | P0 | TODO | dossier parent en différenciateur |
| 3.3 | Round-trip Markdown sans perte + tests auto | M | P0 | TODO | NFR zéro perte ; documenter toute normalisation (ADR-0002) |

## Blockers
_None_

## Progress Log
### 2026-07-09
- Sprint initialisé avec 5 stories (toutes P0), boucle verticale ouvrir→éditer→sauver→zéro perte
- **1.1** ✅ **Done** : démo `DEMO_TABS` chargée uniquement en mode navigateur (`!isTauri`) — en natif l'app démarre vide, pilotée par de vrais fichiers ; état vide minimal (marque D + bouton « Ouvrir · Ctrl+O », clair/sombre validés Playwright) ; `openFromDialog` durci (try/catch). **Ctrl+O sur un vrai `.md` confirmé en natif par l'utilisateur.**
