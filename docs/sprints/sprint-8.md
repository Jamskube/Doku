# Sprint 8

**Goal** : Recherche plein-texte fonctionnelle **de bout en bout** — chercher dans un dossier de notes et sauter au résultat.
**Start** : 2026-07-13
**End** : 2026-07-20
**Status** : Active

Premier sprint du **cap v1.5** (source : `docs/planning/PRD-v1.5.md`, Epic 9). Périmètre = Epic 9 entier → à la clôture, la recherche marche complètement (chercher → résultats surlignés → clic → onglet à l'occurrence). Export et lecture PDF = sprints suivants.

## Stories

| # | Story | Size | Status | Notes |
|---|---|---|---|---|
| 9.1 | Spike : stratégie d'index (mémoire vs scan) | S | ✅ Done | **Index-en-mémoire** tranché par mesure (index 0,4-1,6 ms vs scan 20-50 ms/requête) → [ADR-0007](../adr/0007-recherche-index-memoire.md). Forme du SearchService cadrée pour 9.2 |
| 9.2 | Moteur de recherche (scan dossier, casse-insensible, anti-périmé) | M | TODO | Réutiliser `detectUnsupported` (ignorer binaires) ; garde req-token (cf. `loadSnapshotsForActive`) |
| 9.3 | Panneau de recherche (Ctrl+Maj+F, résultats surlignés) | M | TODO | Panneau type Sidebar (Fichiers/Plan/Historique) ; état vide clair |
| 9.4 | Saut vers l'occurrence au clic | S | TODO | Ouvrir l'onglet + scroller sur la ligne (mécanisme scrollToLine déjà utilisé par la TOC 4.6) |

## Blockers
_None_

## Progress Log
### 2026-07-13
- Sprint initialisé avec 4 stories (Epic 9 Recherche complète). Vélocité cible ~4 (S+M+M+S), cohérente avec S6=4 / S7=3.
- Risque principal absorbé par le **spike 9.1** (index vs scan) en tête. Aucune nouvelle stack — pur frontend.
- Après ce sprint : Sprint 9 = Export (Epic 10, avec spike PDF `10.1`) ou Lecture PDF (Epic 11).
- **9.1 ✅** : benchmark → **index-en-mémoire** tranché (recherche 0,4-1,6 ms vs scan 20-50 ms ; > 200× de marge sous 300 ms ; aligné WikilinkResolver), ADR-0007 écrit. Prochain : **9.2** (moteur) sur cette base.
