# Sprint 10

**Goal** : Doku lit les PDF (lecture seule, hors-ligne) et colle les images du presse-papier — **v1.5 feature-complete**.
**Start** : 2026-07-13
**End** : 2026-07-20
**Status** : Completed

Dernier sprint du cap v1.5 (source : `docs/planning/PRD-v1.5.md`, Epics 11-12). À la clôture, tout le PRD-v1.5 est livré (recherche + export + lecture PDF + coller image).

## Stories

| # | Story | Size | Status | Notes |
|---|---|---|---|---|
| 11.1 | Viewer PDF.js bundlé local (lecture seule, scroll/zoom, worker sous CSP) | L | ✅ Done | Validé natif 2026-07-14. Correctif flou HiDPI (scrollbar-gutter + plafond DPR) après validation. |
| 11.2 | `.pdf` comme format supporté (explorateur/associations, lecture seule) | S | ✅ Done | Moitié in-app déjà livrée en 11.1 ; association OS `.pdf` (role Viewer) validée sur confiance (dette : confirmer au prochain install). |
| 12.1 | Coller une image → fichier lié + insertion du lien | M | ✅ Done | Validé natif 2026-07-14. critic a intercepté 2 bugs data-loss HIGH avant code (sérialisation écritures + garde onglet partagé). |

## Blockers
_None_

## Debt (Sprint 9)
- Validation native **10.3** (HTML autonome) + **10.4** (DOCX) en attente (`passes:false`). Action retro : **solder avant de coder par-dessus**.

## Progress Log
### 2026-07-13
- Sprint initialisé avec 3 stories (Epics 11-12). 1 L (11.1) + 1 S (11.2) + 1 M (12.1). Vélocité cible ~4 (S6=4/S7=3/S8=4/S9=4) ; le poids de 11.1 (L) fait de ce sprint un sprint plein.
- Risque principal : **11.1** — bundling PDF.js + worker sous CSP ARM64, non vérifiable en dev navigateur → smoke natif requis (comme la CSP/impression). Micro-spike worker+CSP en tête envisagé.
- Bon présage : permissions binaires (read/write) déjà ajoutées en S9 servent 11.1 (lecture octets PDF) et 12.1 (écriture image collée).
- Après ce sprint : **v1.5 feature-complete** → retro cap v1.5, puis cadrage v2 (copilote Ollama ADR-0006, PRD dédié à écrire).

### 2026-07-14 — Clôture
- **3/3 livrées, ledger 46/46, v1.5 feature-complete.** Dette S9 (10.3/10.4) + 11.1 soldées en un seul `tauri dev` (validation en lot). 3 bugs data-loss HIGH interceptés en revue. Rétro : `retro-sprint-10.md`.
