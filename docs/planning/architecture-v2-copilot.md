# Architecture : Doku v2 — copilote IA local (sous-système)

_Date : 2026-07-14 · Status : Draft_

> Sous-système de l'[architecture Doku](./architecture.md). Spécifie le **copilote IA local** du [PRD-v2](./PRD-v2.md), fondé sur [ADR-0006](../adr/0006-copilote-ia-ollama-sidecar-cpu.md) (Ollama sidecar, CPU, free-GGUF). Le reste de Doku est inchangé ; ce doc ne décrit que ce qui s'ajoute.

## Context

Ajouter au cœur « lecteur/éditeur » un **panneau copilote** qui résume, questionne, reformule et corrige — **100 % local**. Le moteur d'inférence est **Ollama** lancé en **sidecar** (`externalBin` Tauri) et piloté par son **API HTTP `localhost`** ; l'hôte Rust reste minimal (spawn + kill + proxy), conforme à ADR-0004. L'utilisateur **gère ses modèles** (pull/switch/purge). Livraison en deux temps : **v2.0** (fondation + résumer + Q&A doc) ; **v2.1** (RAG dossier + reformuler + corriger). Le principe **zéro réseau à l'inférence** (8.3) est préservé : seul le *pull de modèle* sort, en action explicite.

## Constraints

- **Scale** : mono-utilisateur ; doc courant jusqu'à ~5 Mo ; dossier RAG ~10²-10³ notes ; modèles 3-4B (~2-3 Go/fichier) dans `%APPDATA%`.
- **Latency** : 1er token **< 5 s** ; débit **≥ 10 tok/s** (CPU Snapdragon X Elite) ; 1er prompt après switch modèle **< 15 s** ; annulation **< 500 ms**.
- **Plateforme** : `ollama.exe` **build ARM64 Windows natif** (aucune émulation), sidecar hors-process.
- **Compliance / réseau** : **0 requête non-`localhost`** à l'inférence et à l'indexation (monitoring, comme 8.3) ; le pull est l'unique exception, consentie.
- **Budget** : projet perso, mono-dev — privilégier l'existant (API Ollama toute faite) au sur-mesure.

## High-level shape

```
┌─ Fenêtre Tauri 2 (WebView2) ───────────────────────────────────────────────┐
│  Frontend Svelte 5                                                          │
│  ┌ Sidebar (vue « copilote », comme recherche/plan/historique) ───────────┐ │
│  │ CopilotPanel : chat streaming · annuler · rendu Markdown               │ │
│  │ ModelManager : liste installés · pull (progress) · actif · taille/purge│ │
│  └───────────────┬─────────────────────────────────────────────────────────┘ │
│                  │ actions (résumer / Q&A / reformuler / corriger)           │
│  ┌ Services TS (nouveaux) ─────────────────────────────────────────────────┐ │
│  │ CopilotService  : orchestration prompts + contexte doc + segmentation   │ │
│  │ OllamaClient    : fetch localhost:11434 (/api/generate,/pull,/tags…)    │ │
│  │ ContextBuilder  : doc courant / sélection / [v2.1] passages RAG          │ │
│  │ [v2.1] RagIndex : embeddings + récupération (index %APPDATA%)            │ │
│  └───────────────┬─────────────────────────────────────────────────────────┘ │
│                  │ HTTP localhost (streaming SSE/NDJSON)                      │
├──────────────────┼──────────────────────────────────────────────────────────┤
│  Hôte Rust minimal (ADR-0004) : SidecarManager                              │
│  spawn `ollama serve` (externalBin, port dédié) · health · kill à la fermeture│
└──────────────────┬──────────────────────────────────────────────────────────┘
                   │ 127.0.0.1:<port>                     │ modèles / index
                   ▼                                      ▼
        ollama.exe (ARM64, CPU)   ───lit/écrit───►  %APPDATA%\Doku\models\  (GGUF)
        inférence + embeddings                      %APPDATA%\Doku\rag\      (v2.1)
                   │ pull (action explicite)
                   ▼
        registry Ollama (réseau — SEULE sortie, consentie)
```

## Components

| Component | Responsibility | Technology |
|---|---|---|
| **CopilotPanel** | Vue sidebar : conversation, streaming token-par-token, bouton annuler, rendu Markdown copiable | Svelte 5 (réutilise le pattern des vues sidebar existantes) |
| **ModelManager** | UI modèles : lister (`/api/tags`), pull avec progression (`/api/pull`), choisir l'actif (persisté settings), taille & purge (`/api/delete`) | Svelte 5 + OllamaClient |
| **CopilotService** | Orchestration : construit le prompt par usage (résumer/Q&A/reformuler/corriger), gère la **segmentation** des longs docs (map-reduce), l'ancrage anti-hallucination, l'annulation | TS pur (testable) |
| **OllamaClient** | Client HTTP de l'API Ollama : `generate` (stream), `pull` (stream progress), `tags`, `delete`, `show` ; parse NDJSON ; `AbortController` pour annuler | TS + `fetch` (webview) |
| **ContextBuilder** | Assemble le contexte fourni au modèle : doc courant / sélection (v2.0) ; extraction texte PDF ; [v2.1] passages RAG récupérés | TS pur |
| **RagIndex** *(v2.1)* | Chunking des notes, embeddings locaux (via Ollama `/api/embeddings`), stockage vecteurs + méta, récupération top-k, ré-indexation incrémentale | TS + fichier index `%APPDATA%\Doku\rag\` — **ADR à créer** |
| **SidecarManager** | Rust : `spawn` d'`ollama serve` (externalBin) sur port dédié, health-check, `kill` propre à la fermeture, exposition du port au front | Rust minimal + `tauri-plugin-shell`/`Command` (externalBin) |

## Data model

Pas de base de données ; fichiers, cohérent ADR-0003. Nouvelles familles :

- **Modèles** : gérés par Ollama dans `%APPDATA%\Doku\models\` (via `OLLAMA_MODELS`). Source de vérité = Ollama ; Doku les liste via l'API, ne manipule pas les GGUF directement.
- **Réglage copilote** (`settings.json`, étendu) : modèle actif, préférences (ton de reformulation par défaut, portée doc/dossier), état du panneau.
- **Conversation** : par défaut **éphémère** (mémoire, par session) — persistance = question ouverte (voir §Open questions).
- **Index RAG** *(v2.1)* (`%APPDATA%\Doku\rag\<sha1(dossier)>\`) : vecteurs d'embeddings + méta (chemin, offset du passage, hash pour l'incrémental) + version du modèle d'embedding. Reconstructible → jamais une source de vérité, purgeable.

## External dependencies

- **Ollama (`ollama.exe` ARM64)** — moteur d'inférence + embeddings, en **sidecar** (ADR-0006). Fallback : aucun in-process (llama.cpp = build hell ARM64, écarté) → si le sidecar échoue, le copilote se désactive proprement, le reste de Doku fonctionne.
- **Registry Ollama** (réseau) — **uniquement** pour le pull volontaire de modèles. Indisponible → le pull échoue avec message clair ; l'inférence sur modèles déjà installés reste 100 % locale.
- **Couche texte PDF** (pdf.js, déjà bundlé v1.5) — pour résumer/Q&A un PDF : réutilise `getTextContent` ; PDF scanné sans texte → message clair.

## Cross-cutting

- **Sécurité / réseau** : CSP étendue — `connect-src` autorise `http://127.0.0.1:<port>` (sidecar) en plus de `'self' ipc:`. Le contenu généré par le modèle est **non-fiable** → passe par le pipeline sanitize existant avant rendu (pas de `{@html}` brut). Aucune capability shell générale : le sidecar est lancé en `externalBin` déclaré, pas un `Command` arbitraire.
- **Observability** : `tauri-plugin-log` (existant) → démarrage/arrêt sidecar, échecs pull, latences (1er token, tok/s) en dev ; jamais le contenu des prompts/notes dans les logs.
- **Deployment** : `ollama.exe` ARM64 embarqué comme `externalBin` dans le bundle NSIS (⚠️ taille de l'installateur — voir Failure modes) ; pas d'updater (perso).
- **Failure modes** :
  - **Port occupé / sidecar ne démarre pas** → message clair, copilote désactivé, app utilisable.
  - **Process orphelin** → `kill` au `WindowEvent::CloseRequested` + health au démarrage (tuer un `ollama serve` Doku résiduel).
  - **Aucun modèle installé** → onboarding vers le pull d'un modèle conseillé (pas d'erreur brute).
  - **Doc > fenêtre de contexte** → segmentation map-reduce (CopilotService), jamais de troncature silencieuse.
  - **Génération trop lente / bloquée** → streaming + annulation `AbortController` (< 500 ms) ; timeout.
  - **Pull interrompu** (réseau) → reprise/erreur claire ; jamais de modèle à moitié installé marqué actif.
  - **Taille disque** → ModelManager affiche tailles + purge ; alerte de seuil (question ouverte).

## Decisions (link to ADRs)

- [ADR-0006](../adr/0006-copilote-ia-ollama-sidecar-cpu.md) — Moteur = **Ollama sidecar CPU**, NPU écarté — **accepted**. Fonde tout ce sous-système.
- **À créer** → `/create-adr` : **cycle de vie du sidecar** (port dédié vs fixe 11434, découverte, kill, externalBin vs shell) — fork non trivial, à figer avant le spike.
- **À créer** → `/create-adr` : **stack RAG** (modèle d'embedding local, format d'index vectoriel maison vs lib, ré-indexation incrémentale) — le gros fork de v2.1, précédé d'un spike.
- **À créer (option)** → `/create-adr` : **persistance de l'historique de chat** (éphémère vs disque, portée) si on décide de persister.

## Open questions

- **Port du sidecar** : fixe `11434` (simple, mais collision si l'utilisateur a déjà Ollama) vs **port éphémère dédié** (isolé, recommandé) → à trancher dans l'ADR cycle-de-vie.
- **Modèle conseillé par défaut** (onboarding) : `llama3.2:3b` / `qwen2.5:3b` / `phi-3.5` — qualité FR/EN vs vitesse X Elite (PRD Q1).
- **Modèle d'embedding RAG** (v2.1) : lequel tourne bien via Ollama en ARM64 (`nomic-embed-text` ? `mxbai-embed-large` ?) — PRD Q3.
- **Persistance du chat** : par session vs disque, par doc vs global (PRD Q2).
- **Empreinte installateur** : embarquer `ollama.exe` (~volumineux) dans le NSIS vs le télécharger au 1er lancement (viole moins le bundle mais ajoute une sortie réseau) — à trancher.

## Out of scope

- **NPU** (Hexagon) — incompatible free-GGUF (ADR-0006) ; ADR dédié futur si l'autonomie devient un objectif.
- **Cloud / API distante**, **agents/outils/exécution d'actions**, **génération d'images/voix**, **fine-tuning** — hors v2.
- **Multi-machine / sync de l'index RAG** — jamais visé.
