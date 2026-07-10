# Sprint 6

**Goal** : Clore le dernier epic ouvert — Epic 7 (fenêtre & versions, FR-11/FR-12) — et finir la navigation entre notes (création de wikilink).
**Start** : 2026-07-10
**End** : 2026-07-17
**Status** : Active

## Stories

| # | Story | Size | Status | Notes |
|---|---|---|---|---|
| 7.1 | Épinglage always-on-top (finir + vérif native) | S | ✅ Done | Raccourci Ctrl+Maj+T + `togglePin` centralisé ; validé natif utilisateur (2026-07-10) |
| 7.2 | SnapshotService (copie à la save + purge auto) | M | ✅ Done | `snapshot.ts` (pur, 15 tests) + I/O confiné + panneau Historique ; critic (plan) + code-reviewer (Approve, 2 Minor corrigés) ; validé natif utilisateur (2026-07-10) |
| 7.3 | Restauration depuis l'historique | S | TODO | Snapshot du courant AVANT remplacement (jamais de perte) |
| 4.5 | Désambiguïsation & création de wikilink | S | TODO | Cible inexistante → proposer créer `note.md` à côté ; ambiguë → menu candidats |

## Hors sprint (à traiter au fil de l'eau)
- **4.3** (non supportés grisés/masqués) : déjà satisfait *de facto* (masqués en amont via `visibleEntries`, validé par 1.2/2.4). À formaliser dans le ledger, pas de dev.
- **3.1** (édition live preview, P0) : fonctionnel mais jamais ledgerisé — formaliser/vérifier si l'occasion se présente.
- **3.7** (widgets tableaux & images, dernière P1, L) : délibérément déférée à un sprint dédié (feature éditeur conséquente).

## Blockers
_None_

## Progress Log
### 2026-07-10
- Sprint initialisé avec 4 stories (Epic 7 complet + 4.5). Vélocité cible ~5-6 pts.
- Risque identifié : 7.2 dépend de la décision de stockage ADR-0003 (à lire en premier).
- **7.1 ✅** : raccourci Ctrl+Maj+T + `togglePin` centralisé (store) ; validé natif utilisateur. Piège CM6 `defaultKeymap` (Shift-Mod-t) vérifié absent.
- **7.2 ✅** : SnapshotService (ADR-0003) — copie à la save + purge 20/30j (garde-le-dernier) + panneau Historique daté/aperçu. Passe `critic` (plan) puis `code-reviewer` (Approve, 0 Crit/Major ; 2 Minor corrigés : `meta.json` atomique + réconcilié disque, horodatage synchrone). `remove` confiné à `$APPDATA/snapshots/**`. Restauration = 7.3.
