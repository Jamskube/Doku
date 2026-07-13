# Next session pointer
_Updated: 2026-07-13 18:30_

## Where I left off
**Doku est v1 feature-complete** (ledger 35/35, tout le PRD v1 livré, Epic 3/4/7 clos). 3.7 (widgets tableaux) validé en natif et commité. Retro Sprint 7 faite. Le **cap v1.5 est entièrement planifié** : gate feasibility (recherche/export/PDF = GO ; copilote tranché), **ADR-0006** (copilote = Ollama sidecar CPU, NPU écarté), **PRD-v1.5**, **epics 9-12**, et **Sprint 8 initialisé** (Epic 9 Recherche, 4 stories). Rien n'est encore codé côté v1.5 — la session a été 100 % planification.

## Open work
- Branch: `main` — propre après ce wrap (planif v1.5 commitée)
- Open PRs: aucune
- Sprint actif: **Sprint 8** (`docs/sprints/sprint-8.md`), 2026-07-13 → 2026-07-20, stories `9.1`-`9.4`, ledger 35/39
- Plans/specs: `docs/planning/PRD-v1.5.md`, `docs/planning/epics.md` (Epics 9-12), `docs/adr/0006-*` (copilote v2)

## Next concrete step
**Démarrer la story 9.1 (spike) via `/epct`** : mesurer scan-à-la-volée vs index-en-mémoire sur ~1000 fichiers, trancher (cible < 300 ms), documenter (note/ADR) → puis coder 9.2 (moteur) sur l'approche retenue. Après Epic 9 (recherche de bout en bout) : Sprint 9 = Export (Epic 10, spike PDF `10.1`) ou Lecture PDF (Epic 11). Copilote = plus tard, écrire d'abord le PRD v2 (ADR-0006 déjà en place).
