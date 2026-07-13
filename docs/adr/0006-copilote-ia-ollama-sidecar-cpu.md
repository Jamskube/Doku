# 0006. Copilote IA local : Ollama en sidecar (CPU, GGUF libre) — NPU écarté

**Date** : 2026-07-13 · **Status** : accepted · **Deciders** : nicos (+ Claude) · **Tags** : ia, llm, npu, arm64, copilote

## Context

Le cap v1.5/v2 (gate feasibility, 2026-07-13) retient un **copilote IA local** (résumer / reformuler / Q&A sur un document). Exigence explicite du dev : pouvoir **charger et gérer les modèles soi-même directement dans Doku, à la manière d'Ollama** — l'utilisateur choisit un modèle, le télécharge une fois, le fait tourner en local et en change librement. **Pas** de modèle figé baké dans l'app, **pas** de cloud.

Contraintes acquises : Windows **ARM64** (Snapdragon X Elite, NPU Hexagon ~45 TOPS), Tauri 2 avec **hôte Rust minimal** (ADR-0004), et **zéro requête réseau à l'inférence** (principe 8.3 / CSP).

Deux passes de recherche externe (2026-07-13) ont établi un fait structurel décisif : **le NPU Hexagon ne consomme que de l'ONNX/QNN pré-compilé, jamais du GGUF**. Les moteurs « charge ton GGUF » (Ollama, llama.cpp) tournent **CPU-only** sur X Elite (ni Adreno GPU en pratique, ni NPU). « UX Ollama » et « NPU » sont donc **mutuellement exclusifs** aujourd'hui.

## Decision drivers

- **Exigence produit** : gestion des modèles « à la Ollama » (pull / run / switch), sans installation séparée par l'utilisateur.
- **Hors-ligne au runtime** (principe 8.3) : le réseau ne doit servir qu'au *pull volontaire*, jamais à l'inférence.
- **Rust minimal préservé** (ADR-0004) : ne pas faire vivre un moteur d'inférence in-process.
- **Contrainte ARM64** : ne retenir que ce qui a un build ARM64 Windows réellement stable.
- **Mono-dev** : effort raisonnable, pas de build hell.
- **Fait matériel** : le NPU **n'accélère pas** (génération bornée par la bande passante mémoire, ~30 tok/s plafond) ; son seul gain est **l'autonomie batterie**, pas la vitesse.

## Considered options

### Option 1 : Ollama ARM64 bundlé en sidecar Tauri
Livrer `ollama.exe` (build ARM64 natif) comme `externalBin`, le lancer en `ollama serve`, le piloter via son API HTTP `localhost:11434` (`/api/pull`, `/api/generate`).
· Pros : **exactement l'UX Ollama** (c'est Ollama) ; ARM64 natif stable ; hôte Rust reste une coquille (spawn + proxy HTTP) → ADR-0004 intact ; pull/run/switch gratuits ; hors-ligne à l'inférence. ~2-4 j-h.
· Cons : **CPU-only** (pas de NPU) ; Doku embarque un binaire volumineux ; cycle de vie du process à gérer (spawn/kill, port).

### Option 2 : embarquer le moteur in-process (`llama-cpp-2` / `mistral.rs`)
· Pros : contrôle total, pas de process externe.
· Cons : **casse ADR-0004** (le moteur métier vit dans le Rust) ; `ggml-aarch64.c` **ne compile pas sous MSVC ARM64** (issues ouvertes) → build fragile ; binaire lourd ; **aucun** accès NPU malgré tout. ~6-10 j-h + build hell.

### Option 3 : Foundry Local (NPU) en sidecar
· Pros : exploite réellement le NPU (autonomie batterie) ; serveur HTTP OpenAI-compatible ; Rust minimal préservé.
· Cons : **catalogue QNN fermé** (modèles pré-convertis, **pas de free GGUF loading**) → **contredit l'exigence produit** ; QNN EP encore en rodage ; **bug de détection NPU spécifique Surface Pro 11** (Foundry Local #797, *fixed-pending-release*).

### Option 4 : `llamafile` / Option 5 : API cloud
· llamafile : support **ARM64 Windows non confirmé** → pari écarté. · Cloud : **viole le hors-ligne au runtime** → écarté d'emblée.

## Decision

**Choisi : Option 1 — Ollama ARM64 en sidecar.** C'est la seule voie qui livre réellement l'UX « charge tes modèles toi-même » demandée, en natif ARM64 stable, hors-ligne à l'inférence, **sans casser le Rust minimal** (ADR-0004). Modèles stockés en `%APPDATA%\Doku\models\` ; le **pull** est une action réseau *explicite, initiée par l'utilisateur*, jamais automatique — l'inférence reste 100 % locale.

**Le NPU est explicitement hors-scope de cette feature** : structurellement incompatible avec le free-GGUF loading voulu, et son unique bénéfice (batterie) ne justifie pas un second moteur à catalogue fermé. Toute piste NPU future (Foundry Local, catalogue QNN) sera une **voie parallèle distincte**, n'ouvrant **que si l'autonomie batterie devient un objectif produit explicite**, et exigera **son propre ADR**.

## Consequences

**Positive** : UX Ollama fidèle (pull/run/switch) ; ARM64 natif stable ; ADR-0004 préservé (hôte Rust = spawn + proxy) ; hors-ligne à l'inférence respecté ; liberté totale de modèles (3B-4B type Phi-3.5 / Llama-3.2-3B / Qwen2.5 tournent à vitesse « chat » ~10-20 tok/s CPU).
**Negative** : pas de gain NPU (autonomie batterie) ; Doku distribue un `ollama.exe` volumineux ; les fichiers modèles (Go) vivent dans `%APPDATA%` → prévoir une UX de gestion (taille, purge) ; vitesse plafonnée au CPU.
**Risks** :
- Cycle de vie du sidecar (port occupé, process orphelin) → port dédié + kill propre à la fermeture.
- Principe 8.3 (zéro réseau) vs pull → le download doit être **une action utilisateur clairement séparée** ; réconcilier avec la CSP (l'inférence `localhost` ne sort pas ; le pull est une exception explicite et consentie).
- Backend Adreno/NPU d'Ollama annoncé « planifié » → **s'il atterrit, re-gater** : on pourrait gagner GPU/NPU *gratuitement* via la même UX. Décision bon marché à revisiter.

## Related

- [ADR-0001](./0001-stack-tauri-svelte.md) — la stack Tauri qui rend le sidecar possible
- [ADR-0004](./0004-io-fichiers-plugins-officiels.md) — « Rust minimal » ; **ce choix le préserve** (sidecar, pas de moteur in-process)
- `docs/sprints/retro-sprint-7.md` — gate feasibility v1.5/v2 (recherche, export, PDF, copilote) qui a produit cette décision
- Story 8.3 (zéro requête réseau au runtime) — contrainte réconciliée ici (pull explicite ≠ inférence)
