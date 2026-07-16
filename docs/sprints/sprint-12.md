# Sprint 12

**Goal** : **v2.0 livrée** — le copilote dialogue, résume et répond sur le document ouvert, et Doku s'installe avec son moteur embarqué.
**Start** : 2026-07-16
**End** : 2026-07-23
**Status** : Active

1er sprint au **format recalibré** (rétro S11) : **1 semaine / 6-8 stories** au lieu de 2 semaines / 3-4. Source : `docs/planning/PRD-v2.md` (FR-3, FR-4, FR-5 → Epic 14 ; FR-7, FR-8 → Epic 16). À la clôture : le copilote est **utilisable** (chat streamé, résumé, Q&A ancrée) et le sidecar est **prouvé en release installée**.

**Design hors sprint** : l'UI du panneau copilote (14.1) est itérée séparément (préférence actée en rétro S1). Les stories consomment la maquette validée ; elles ne la conçoivent pas.

## Stories

| # | Story | Size | Status | Notes |
|---|-------|------|--------|-------|
| 14.1 | Panneau copilote (chat, streaming, annuler, rendu MD sanitizé) | M | TODO | Consomme le store `copilot.svelte.ts` (13.4). **Supprime `OllamaSpike.svelte`** (widget DEV jetable). Rendu MD via `renderMarkdown` + `sanitizeHtml` (ADR-0009, réutilisé de l'export). **Attend la maquette** (design hors sprint). |
| 14.2 | Résumer le document (md/txt/html/PDF, map-reduce si > contexte) | M | TODO | **Risque n°1.** Segmentation map-reduce obligatoire — le PRD interdit la **troncature silencieuse**. PDF scanné sans texte → message clair. |
| 14.3 | Q&A sur le document courant (ancrée, « je ne trouve pas ») | S | TODO | Réponse ancrée sur le doc ; info absente → refus explicite, pas d'invention. 0 requête réseau. |
| 13.5 | Packaging release du sidecar (build ARM64 + install) | S | TODO | **Solde 2 dettes** : `resource_dir()`/`bundle.resources` jamais prouvés en release (S11) + association `.pdf` validée « sur confiance » (S10). |
| 16.1 | Reformuler une sélection — **stretch** | M | TODO | Réutilise la machinerie `generate` de 14.1, indépendant du RAG. **Coupable en premier** si le sprint déborde. |
| 16.2 | Corriger orthographe & grammaire — **stretch** | S | TODO | Idem. Ne doit changer ni le sens ni le Markdown ; annulable (Ctrl+Z). |

## Blockers
_None_

## Checkpoints STOP/GO
| ~% | Critère | Si STOP |
|---|---|---|
| 30 % (14.1) | Chat streamé + annulable dans le panneau, rendu MD sanitizé | Revoir le store copilote (13.4) avant d'empiler les usages |
| 50 % (13.5) | Doku **installé** génère (lib chargée via `resource_dir`) + double-clic `.pdf` ouvre | Bug de packaging → traiter en priorité : sans ça, v2 n'est pas distribuable |
| 80 % (14.2-14.3) | Résumé d'un doc > fenêtre de contexte **sans troncature silencieuse** ; Q&A refuse d'inventer | Livrer 14.1+14.3, reporter 14.2 (map-reduce = story à part entière) |
| Stretch (16.x) | — | Couper sans état d'âme, retour en v2.1 (Sprint 13) |

## Progress Log
### 2026-07-16
- Sprint initialisé avec **6 stories** (5 du backlog + 1 nouvelle). Premier sprint à 1 semaine (action rétro S11 : 4×M livrés en 1 jour vs 2 semaines planifiées).
- **13.5 créée** (hors décomposition initiale) : ajoutée à l'Epic 13 dans `epics.md`. Solde les 2 dettes « à confirmer au prochain build+install » avant qu'une 3e ne s'accumule (action rétro S11, High).
- **Epic 16 remontée en stretch** : le PRD-v2 la séquence en v2.1 (avec le RAG), mais 16.1/16.2 réutilisent exactement le `generate` de 14.1 et **ne dépendent pas de l'Epic 15**. Les remonter isole le RAG (spike + L, le gros chantier risqué) dans un Sprint 13 dédié → **v2 bouclée en 2 sprints**.
- **Correction du décompte de la rétro S11** : il reste **8** stories v2 (Epic 14 : 3 · Epic 15 : 3 · Epic 16 : 2), pas ~12 (c'était le total des Epics 13-16, dont l'Epic 13 déjà livrée).
- Design du panneau copilote traité **hors sprint** (Claude Design) ; 14.1 démarre une fois la maquette arrêtée.
