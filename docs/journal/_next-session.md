# Next session pointer
_Updated: 2026-07-14 12:00_

## Where I left off
**Doku v1.5 feature-complete.** Sprint 10 (Epics 11-12) **clos, ledger 46/46** — 11.1 (lecteur PDF), 11.2 (association OS `.pdf`), 12.1 (coller image) livrées + validées natif. Correctif flou PDF (HiDPI : `scrollbar-gutter` + DPR). Dette S9 (10.3/10.4) soldée. Tout le PRD-v1.5 est livré (recherche + export PDF/HTML/DOCX + lecture PDF + coller image). Chaque story passée par EPCT → critic → code-reviewer → validation native ; **3 bugs data-loss HIGH interceptés** en revue. Rétro Sprint 10 écrite (`docs/sprints/retro-sprint-10.md`).

## Open work
- Branch: `main` — **propre** (rien de non commité), poussé (`bf48190`)
- Open PRs: aucune
- Sprint actif: **aucun** (Sprint 10 Completed). Prochain cadrage = **cap v2**.
- Dette : (1) confirmer l'association OS `.pdf` au prochain `tauri build` + install ; (2) bundling cmap/wasm pdfjs (CJK/JPEG2000) ; (3) zoom PDF ; (4) tmp-orphelin `.doku-tmp` non nettoyé (cosmétique).

## Next concrete step
**Cadrer le cap v2** : rétro globale v1.5 puis **PRD-v2** — le gros morceau est le **copilote IA local (Ollama sidecar CPU, ADR-0006)**. Alternative avant de coder : passer les 4 leçons de la rétro S10 en `/start learn` (netteté HiDPI, garde onglet-partagé CM6, sérialisation des écritures event, extraction clipboard synchrone) si pas déjà fait.
