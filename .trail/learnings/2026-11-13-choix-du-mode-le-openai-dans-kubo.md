---
title: Choix du modèle OpenAI dans le catalogue du compte
author: Kubo
date: 2026-11-13
branch: main
cost: { minutes: 5, tokens: 101256 }
touches:
  - src-tauri/src/compat.rs
  - src-tauri/src/main.rs
  - src-tauri/src/openai.rs
  - src-tauri/src/sidecar.rs
  - src-tauri/src/sse.rs
  - src-tauri/src/web_search.rs
  - src/App.svelte
  - src/assets/icons.svg
  - src/components/CopilotPanel.svelte
  - src/components/DocxView.svelte
---

## Decided
- Le modèle OpenAI est choisi par l'utilisateur dans le catalogue du compte (`app.openaiModel`, persisté ; '' = défaut `OPENAI_MODEL` gpt-5.6-luna). Même schéma que MiniMax : liste dynamique, normalisation quand le modèle choisi sort du catalogue (`refreshOpenAiStatus`).
- Le catalogue était déjà lu par `fetch_models` (src-tauri/src/openai.rs) ; seul le choix était verrouillé, en trois endroits : la garde `request.model != PREFERRED_MODEL` de `stream_openai`, la constante envoyée par `streamOpenAi` (src/lib/openai.ts), et le sélecteur de CopilotPanel.svelte.
- Garde Rust : `ensure_model_allowed` accepte uniquement un modèle présent au catalogue du compte, mis en cache dans `OpenAiState.models` (rempli par `openai_status`, relu une fois si le cache est vide, vidé à la déconnexion).
- `openAiChat` / `openAiGenerate` prennent le modèle en premier paramètre (comme `compatChat`), fourni par `runtime.model`.
- `copilot.openAiPreferredAvailable` signifie désormais « le catalogue contient au moins un modèle », plus « Luna est disponible ».

## Tried and ruled out
- Importer `app` dans src/lib/openai.ts pour y lire le modèle : écarté, le module reste sans dépendance au store, le modèle passe en paramètre.
- Liste de modèles codée en dur côté front : écartée, le catalogue du compte fait foi.

## Watch out
- Non essayé dans l'app native à la date de la note : seuls `npm run check`, vitest et `cargo test openai` ont tourné. Aucune génération réelle avec un modèle autre que Luna 5.6.
- L'effort de raisonnement envoyé reste `low` (ou `high` avec « Réfléchir ») pour tous les modèles ; le catalogue expose `supported_reasoning_levels` par modèle, non lu.
- `OPENAI_MODELS_URL` porte `client_version=1.0.0` : hypothèse, non vérifiée, que le backend ne masque aucun modèle récent pour cette version.
- ADR-0013 et ADR-0014 décrivent encore Luna comme modèle unique.
- Écrire un script de patch via heredoc bash a échoué sur les apostrophes typographiques ; passer par un fichier `.mjs` écrit sur disque.
