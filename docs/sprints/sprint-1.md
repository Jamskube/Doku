# Sprint 1

**Goal** : Ouvrir, éditer et sauver de vrais fichiers Markdown en natif — sans jamais perdre de données.
**Start** : 2026-07-09
**End** : 2026-07-16
**Status** : Active

## Stories

| # | Story | Size | Priority | Status | Notes |
|---|-------|------|----------|--------|-------|
| 1.1 | Ouverture réelle via dialogue + I/O natif (Ctrl+O) | S | P0 | ✅ Done | Validé natif 2026-07-09 (Ctrl+O sur vrai `.md`) ; démo gatée `!isTauri` + état vide clair/sombre |
| 3.2 | Sauvegarde atomique + indicateur « modifié » (Ctrl+S) | S | P0 | Review | `saveActive` durci (marque « enregistré » seulement après écriture réussie) ; flux dirty→enregistré validé Playwright ; tmp+rename natif = test utilisateur |
| 3.4 | Confirmation de fermeture non sauvée (Sauver/Ignorer/Annuler) | S | P0 | ✅ Done | Modal `ConfirmDialog` + `requestCloseTab` ; 3 actions validées Playwright ; garde de quit fenêtre (`onCloseRequested`) = smoke test natif |
| 2.2 | Nouvel onglet actif + différenciateur d'homonymes | S | P0 | TODO | dossier parent en différenciateur |
| 3.3 | Round-trip Markdown sans perte + tests auto | M | P0 | ✅ Done | Vitest ajouté ; `serializeDoc`/`detectLineEnding` préservent la fin de ligne (LF+CRLF byte-identique) ; 19 tests verts |

## Blockers
_None_

## Progress Log
### 2026-07-09
- Sprint initialisé avec 5 stories (toutes P0), boucle verticale ouvrir→éditer→sauver→zéro perte
- **1.1** ✅ **Done** : démo `DEMO_TABS` chargée uniquement en mode navigateur (`!isTauri`) — en natif l'app démarre vide, pilotée par de vrais fichiers ; état vide minimal (marque D + bouton « Ouvrir · Ctrl+O », clair/sombre validés Playwright) ; `openFromDialog` durci (try/catch). **Ctrl+O sur un vrai `.md` confirmé en natif par l'utilisateur.**
- **3.2** → Review : `saveActive` durci contre la perte de données — `savedContent` ne passe à jour qu'**après** une écriture réussie ; échec d'écriture → buffer intact + onglet reste « modifié » (bandeau [Réessayer/Enregistrer sous] = story ultérieure) ; onglet natif sans `path` → pas de faux « enregistré ». Flux frappe→dirty→Ctrl+S→enregistré validé Playwright. Reste : confirmer tmp+rename sur un vrai fichier en natif.
- **3.4** ✅ **Done** : modal `ConfirmDialog` (3 boutons, tokens AIR, backdrop flouté) piloté par promesse dans le store ; `saveTab()` centralisé (réutilisé par Ctrl+S et la confirmation) ; `requestCloseTab()` branché sur Ctrl+W + X onglet + clic-milieu ; garde de fermeture de fenêtre via `onCloseRequested` (réutilise `close()`, sans permission `destroy`). Validé Playwright : dirty→dialogue, Annuler garde, Ignorer ferme sans sauver, Sauver sauve+ferme, non-dirty ferme direct. Smoke test natif du quit fenêtre = côté utilisateur.
- **Logo** : nouvelle icône d'app (carré arrondi plein, D centré) régénérée + `build.rs` (`rerun-if-changed` icône) ; marque in-app `DokuMark` (thème-adaptative, ombre du pli crème/sombre) sur rail, ruban sidebar, état vide. Commits `feat: nouveau logo…`.
- **3.3** ✅ **Done** : Vitest installé (`npm test`, config `node`). Découverte : `state.doc.toString()` **normalise toujours en \n** (le facet `lineSeparator` ne joue que sur le split, pas la sérialisation) → correction par `detectLineEnding` + `serializeDoc` (restitue la fin de ligne du fichier). `DocTab.eol` détecté à l'ouverture, sérialisation dans l'updateListener. 19 tests verts : LF & CRLF byte-identiques après édition, mixte → dominante (normalisation documentée FR-3). Non-régression 3.2/3.4 revérifiée (Playwright).
