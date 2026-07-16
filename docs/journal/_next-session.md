# Next session pointer
_Updated: 2026-07-16 12:20_

## Where I left off
**Cap v2 (copilote IA local) — v2.0 aux deux tiers.** Sprint 11 clos (Epic 13, moteur), rétro faite, **vélocité recalibrée** (sprints 1 semaine / 6-8 stories). **Sprint 12 en cours** (v2.0 : panneau + usages doc) : la maquette hifi Claude Design est vendorée (`docs/design/w2-copilot/`), le copilote est un **panneau `aside` droit « Doku-San »**. **14.0** (coquille + chrome + relocalisation des modèles) et **14.1** (chat streaming, rendu Markdown en allowlist stricte = 0 réseau, annulable) sont **livrées et validées natif**. Ledger **52/57**.

## Open work
- Branch: `main` — **propre** (poussé, `02a1fef`)
- Open PRs: aucune
- Sprint actif: **Sprint 12** (v2.0), reste **14.2 / 14.3 / 13.5** (cœur) + **16.1 / 16.2** (stretch)
- Prérequis machine : `src-tauri/binaries/ollama-*.exe` + `lib/ollama/` en place (non commités)
- Dette : (1) **13.5** packaging release — `resource_dir()`/`bundle.resources` jamais prouvés en install + association `.pdf` (S10) → **au prochain `tauri build`** ; (2) pare-feu `ollama.exe` = garantie dure 8.3 ; (3) extraction texte PDF (pdf.js `getTextContent`) pour Q&A/résumé sur PDF (14.2/14.3) ; (4) contexte multi-docs (`+ Contexte`) = coquille désactivée → Epic 15 (RAG) ; (5) débit `t/s` de la carte modèle actif = à mesurer.

## Next concrete step
**`/epct 14.2`** — « Résumer le document » avec **segmentation map-reduce** des longs docs (pas de troncature silencieuse ; PDF scanné sans texte → message clair). Réutilise `generate()` (single-shot) + `copilot-service.ts`. Alternatives : `/epct 13.5` (packaging release, indépendant, solde 2 dettes) ou `/epct 14.3` (Q&A ancrée, refus d'inventer).
