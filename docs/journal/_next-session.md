# Next session pointer
_Updated: 2026-07-16 15:35_

## Where I left off
**Cap v2 (copilote IA local) — v2.0 sur son cœur, Sprint 12 quasi bouclé (ledger 55/57).** Epic 14 **complet** : chat (14.1), **résumer** (14.2, map-reduce sans troncature silencieuse), **Q&A ancrée** (14.3, refus d'inventer). **13.5** packaging release **prouvé** (build NSIS arm64 + génération réelle depuis `target/release` ; `ollama.exe` + `lib/ollama/` frères sous `resource_dir()` ; app installée OK + assoc `.pdf`). Ancrage Q&A durci (température 0.2 + rappel collé à la question, commit `6947b5d`) après une dérive constatée en natif — atténuée mais pas éliminée : **plafond du modèle 0.5b**. Reste seulement **16.1 / 16.2 (stretch)**.

## Open work
- Branch: `main` — **propre** (poussé jusqu'à `6947b5d`)
- Open PRs: aucune
- Sprint actif: **Sprint 12** (v2.0) — cœur livré (14.0/14.1/14.2/14.3/13.5) ; reste **16.1** (reformuler) + **16.2** (corriger), tous deux **stretch**
- Prérequis machine : `src-tauri/binaries/ollama-*.exe` + `binaries/lib/ollama/` en place (non commités) ; installateur buildé à `src-tauri/target/release/bundle/nsis/Doku_0.1.0_arm64-setup.exe`
- Dettes restantes : (1) extraction texte PDF (pdf.js `getTextContent`) pour résumé/Q&A sur PDF ; (2) pare-feu `ollama.exe` (garantie dure 8.3) ; (3) débit `t/s` carte modèle actif (à mesurer) ; (4) contexte multi-docs `+ Contexte` = coquille → Epic 15 (RAG)
- Pistes actées : **upgrade modèle** → Gemma 3n E2B/E4B ([[upgrade-modele-copilote]]) ; **lecture complète gros doc** → RAG Epic 15 (mode « document courant » en 15.3)

## Next concrete step
**`/epct 16.1`** — « Reformuler une sélection » (stretch) : réutilise `generate()` + le pipeline copilote, indépendant du RAG ; texte sélectionné → proposition (clarifier/raccourcir/ton), accepter remplace / refuser laisse l'original intact (zéro perte). Alternative : `/sprint retro` (Sprint 12 quasi terminé, cœur livré → capitaliser), ou couper les stretch et clore la v2.0.
