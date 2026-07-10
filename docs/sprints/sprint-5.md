# Sprint 5

**Goal** : Ouvrir plus de situations de fichiers, plus souplement — élargir et durcir l'ouverture.
**Start** : 2026-07-10
**End** : 2026-07-17
**Status** : Active

## Stories

| # | Story | Size | Priority | Status | Notes |
|---|-------|------|----------|--------|-------|
| 2.4 | Glisser-déposer de fichiers dans la fenêtre | S | P1 | TODO | événement drop Tauri/webview → openPath ; partiellement testable navigateur |
| 1.2 | Détection d'encodage & fichiers non supportés | S | P1 | TODO | non-UTF-8/binaire → message clair, sans planter ni corrompre |
| 5.3 | Support `.txt` (éditeur simple) | S | P2 | TODO | kind 'txt' déjà présent ; éditeur CM6 nu (pas de live preview), sauvegarde fiable |
| 8.3 | Zéro requête réseau au runtime | S | P1 | TODO | monitorer le réseau à l'exécution → aucune requête (polices/assets bundlés) |
| 1.6 | Gros fichiers (≥ ~2 Mo) réactifs | M | P1 | TODO | pas de gel > 200 ms ; proposer bascule mode source au-delà d'un seuil |

## Blockers
_None_

## Progress Log
### 2026-07-10
- Sprint initialisé : 5 stories (4 P1, 1 P2) issues du backlog restant (epics.md)
- Écartées volontairement : Ctrl+F, export, PDF, NPU — différées v1.5/v2 (pas de critère d'acceptance ; nécessitent `/gate` ou cadrage avant d'entrer au backlog)
- Rappels process (rétros S1-S4) : design hors stories ; logique pure → tests unitaires ; smoke-tester en natif/release tôt ; privilégier le browser-testable
