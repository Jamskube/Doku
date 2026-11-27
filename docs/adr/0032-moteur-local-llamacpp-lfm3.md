# 0032. Moteur IA local : llama.cpp (routeur `llama-server`) et LFM3-Omni-2B, Ollama retiré

**Date** : 2026-11-27 · **Status** : accepted · **Deciders** : nicos (+ Claude) · **Tags** : ia, llm, sidecar, llamacpp, lfm3, arm64, distribution · **Spike** : `spike/llamacpp-lfm3/` · **Remplace** : ADR-0006 (moteur), ADR-0012 (cycle de vie, en partie), ADR-0025 (moteur Linux)

## Contexte

Le spike `spike/llamacpp-lfm3/` (mesures du 2026-11-27 sur la Surface Pro 11) a établi deux faits :

- **Ollama est un `llama-server` sous une couche Go**, livré avec un `ggml-cpu.dll` compilé **sans** `DOTPROD`/`MATMUL_INT8`. Sur le même fichier de modèle, le build officiel de llama.cpp b12810 fait le prefill **2,7× à 4,5× plus vite**. Mettre Ollama à jour (0.40.18) ne change rien.
- **LFM3-Omni-2B Q4_0** tient la longueur bien mieux que qwen2.5 1.5b : le decode reste quasi plat (~30 → 23 t/s), et un résumé de 400 tokens sur 14 400 caractères prend **33 s, contre 93,5 s** avec la pile actuelle. Il compte aussi 13 % de tokens en moins en français, pour une RAM équivalente (~1,9 Go).

L'utilisateur a tranché : passer sur llama.cpp, mettre LFM3 par défaut, et perdre les modèles Ollama installés.

## Décision

**Moteur : `llama-server` b12810 en mode routeur, livré dans le paquet.** Le dossier `src-tauri/binaries/llama/` (exécutable, DLL ou `.so`, licences) est préparé par `scripts/prepare-llama-sidecar.mjs` à partir de l'archive officielle, épinglée par SHA-256. Il est livré comme **ressource** `llama/` et non comme `externalBin` : le chargeur Windows cherche les DLL à côté de l'exécutable. Sous Linux, `LD_LIBRARY_PATH` pointe sur ce dossier.

Le moteur est lancé côté Rust par `sidecar.rs` (`start_engine`/`stop_engine`), qui reprend ce qu'ADR-0012 avait déjà posé :

- port éphémère sur `127.0.0.1` ;
- spawn paresseux ;
- Job Object `KILL_ON_JOB_CLOSE`, dont héritent aussi les processus enfants du routeur ;
- `--offline` et `--no-ui` ;
- `--cors-origins` limité aux origines de la webview.

La permission `shell:allow-execute` côté webview disparaît.

**Ollama est aussi retiré sous Linux, ce qui renverse ADR-0025.** L'argument d'ADR-0025 (« l'archive Linux d'Ollama pèse 1,44 Go ») ne s'applique pas à llama.cpp : sa release CPU fait quelques dizaines de Mo. L'AppImage, le `.deb` et le paquet Arch embarquent donc le même moteur. Le paquet Arch le place dans `/usr/lib/doku/llama`.

**Modèles : catalogue fermé côté Rust (`models.rs`).** Chaque entrée porte :

- une URL Hugging Face épinglée à une révision ;
- son SHA-256 et sa taille ;
- sa fenêtre de contexte ;
- son rôle (chat ou embedding).

| Id | Fichier | Rôle |
|---|---|---|
| `lfm3-omni-2b` | `LiquidAI/LFM3-Omni-2B-GGUF` · `LFM3-Omni-2B-Q4_0.gguf` (1,05 Go) | chat, défaut, `c = 16384`, `reasoning = off` |
| `granite-embedding-278m` | `bartowski/granite-embedding-278m-multilingual-GGUF` · Q8_0 (303 Mo) | embeddings RAG (ADR-0015 inchangé sur le fond) |

Le téléchargement est une **action explicite**. Il se fait en flux, avec un hash incrémental, dans un fichier `.partial` renommé seulement si l'empreinte correspond. La progression passe par l'événement `model-download`, et le téléchargement s'annule.

Il n'y a plus de saisie libre d'un nom de modèle, puisqu'il n'y a plus de registre. Ajouter un modèle, c'est ajouter une ligne au catalogue.

Les modèles vivent dans `app_data/llama-models`. Le preset INI du routeur est **régénéré à chaque démarrage** depuis les fichiers présents, avec `threads = min(4, n)`, `parallel = 1` et `load-mode = none`. Le spike a montré que les défauts de llama.cpp (10 threads, mmap, 4 slots) font tomber le decode à 9 t/s. Après un téléchargement ou une suppression, le moteur est arrêté ; il redémarre au prochain usage avec le preset à jour.

**Client : API OpenAI de llama-server** (`src/lib/llama.ts`) :

- SSE sur `/v1/chat/completions` ;
- `/v1/embeddings` ;
- disponibilité testée sur `GET /models`.

L'identifiant de fournisseur `'ollama'` devient `'local'`. Les réglages persistés sont migrés : `copilotProvider: 'ollama'` devient `'local'`, et un `activeModel` ou un `embedModel` qui contient « : » est effacé, car c'est une étiquette Ollama.

## Conséquences

**Positif**

- Prefill 3 à 4× plus rapide, et les longs documents résumés en un tiers du temps.
- Une seule pile sur Windows et Linux, avec une couche Go en moins.
- Le catalogue et les empreintes ferment la porte à un modèle arbitraire.
- La vision et la voix de LFM3 (mmproj Q8_0, 507 Mo) sont à portée sans changer de moteur.

**Négatif / à suivre**

- **Les modèles Ollama déjà installés ne sont plus vus.** Leur dossier (`app_data/models`, plusieurs Go) reste sur le disque tant que l'utilisateur ne le supprime pas : on ne l'efface pas en douce.
- La vision et la voix sont **reportées**. Elles demanderont d'ajouter le mmproj au catalogue, puis de normaliser les nombres pour la synthèse vocale (mesure du spike).
- Le routeur n'a pas d'`--api-key`. Il est joignable par tout processus local qui trouve son port, exactement comme l'était Ollama (ADR-0012).
- Le bit exécutable de `llama-server` dans l'AppImage ne peut pas être corrigé au lancement (squashfs en lecture seule). La CI vérifie qu'il est posé et que le moteur extrait répond.
