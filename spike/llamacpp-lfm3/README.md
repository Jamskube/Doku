# Spike — llama.cpp seul (sans Ollama) + LFM3-Omni-2B, mesuré sur la Surface Pro 11

> **Statut : mesure terminée le 2026-11-27. Aucun code produit modifié.** Deux décisions séparées en fin de document : **(A)** remplacer Ollama par llama.cpp, **(B)** adopter LFM3-Omni-2B (texte, vision, voix).

## Purpose

Mesurer, sur **cette** machine, si (a) `LiquidAI/LFM3-Omni-2B` (texte + image + audio en entrée, texte + parole 24 kHz en sortie) est utilisable dans Doku et (b) si `llama-server` peut remplacer le sidecar Ollama. Le protocole texte reprend celui de `spike/npu-17.1/` (même corpus `longdoc.mjs`, même tâche de résumé, 400 tokens de sortie) pour que les chiffres se comparent à la baseline Ollama d'[ADR-0016](../../docs/adr/0016-backend-inference-npu-foundry-local.md).

## Conditions de mesure (à lire avant les chiffres)

| Élément | Valeur |
|---|---|
| Machine | Surface Pro 11, **Snapdragon X Plus X1P64100** (10 cœurs — pas « Elite »), 16 Go, Windows 11 ARM64 |
| Charge | Chrome, plusieurs sessions Claude, `npm run tauri dev` de l'utilisateur : **0,4 à 3,7 Go de RAM disponible** selon le moment. Écarts de ±30 % entre runs identiques |
| Disque des modèles | `G:` = **SSD USB Samsung T7** (les modèles de Doku vivent sur `C:` NVMe) : les chargements à froid ne sont pas représentatifs |
| llama.cpp | release **b12810** (2026-11-27), `llama-b12810-bin-win-cpu-arm64.zip`, sha256 `b14e4742f5a233e7cccfc4b2766ea06a7c3eaea397b137d4838acb79af1d2b7d`, version `1.1.0-dev (build 12810, commit ca123ba76)`, Clang 22 arm64. Le modèle exige ≥ b11960 (v0.8.0) : OK |
| Ollama de référence | **0.32.0** = le sidecar actuel de Doku (`src-tauri/binaries`), lancé à part sur le port 8099 avec ses propres modèles |
| Modèles | `qwen2.5:1.5b-instruct-q4_0` = **le même fichier** (blob Ollama `sha256-a3b7d8df…`, vérifié) des deux côtés ; `LFM3-Omni-2B-Q4_0.gguf` / `Q4_K_M.gguf` + `mmproj-LFM3-Omni-2B-Q8_0.gguf` (dépôt officiel `LiquidAI/LFM3-Omni-2B-GGUF`) ; `granite-embedding:278m` = même blob des deux côtés |
| Réglages llama.cpp retenus | `threads = 4`, `parallel = 1`, `load-mode = none`, `c = 12288` (Ollama : 5 threads, `--no-mmap`, `-np 1`, choisis par lui) |

Le prefill est mesuré avec un **préfixe unique par requête** (`[Demande n° …]`) : sans lui, Ollama réutilise le KV du run précédent et le prefill tombe à 36 ms — un premier passage l'a montré, il a été jeté.

## Recette (reproductible, ~6 Go de téléchargements)

```powershell
# 1. llama.cpp (13 Mo) — vérifier le sha256 ci-dessus
curl.exe -L -o .cache\dl\llama.zip https://github.com/ggml-org/llama.cpp/releases/download/b12810/llama-b12810-bin-win-cpu-arm64.zip
Expand-Archive .cache\dl\llama.zip .cache\llama-b12810
# 2. Modèles : chemins locaux uniquement (jamais -hf à l'exécution)
#    LiquidAI/LFM3-Omni-2B-GGUF : LFM3-Omni-2B-Q4_0.gguf + mmproj-LFM3-Omni-2B-Q8_0.gguf
# 3. Serveur unique en mode routeur (un process par modèle chargé, comme Ollama)
.cache\llama-b12810\llama-server.exe --host 127.0.0.1 --port 8090 --models-preset models.ini --models-max 2 --offline --no-ui
# 4. Bancs (depuis ce dossier)
node bench-text.mjs <cible.json> 3          # prefill/decode/RAM, corpus npu-17.1
node quality-fr.mjs http://127.0.0.1:8090 lfm3-q4_0-text qwen-q4_0
node vision.mjs     http://127.0.0.1:8090 lfm3-q4_0
node speech.mjs     http://127.0.0.1:8090 lfm3-q4_0
node embed-parity.mjs http://127.0.0.1:<ollama> http://127.0.0.1:8090
```

`models.ini` (preset du routeur) déclare `lfm3-q4_0` (avec mmproj : vision + voix), `lfm3-q4_0-text` (sans mmproj), `qwen-q4_0` et `granite` (`embedding = true`). Les chemins y sont absolus : à adapter.

## 1. Le build llama.cpp

- **Un build ARM64 Windows officiel existe** (CPU, Vulkan, OpenCL-Adreno, CUDA). Pas de build Windows pour le backend Hexagon (`*-snapdragon` : Android et Linux seulement).
- **Mode routeur : oui.** `llama-server` sans modèle + `--models-preset models.ini` sert plusieurs modèles dans un même point d'entrée, en lançant **un process enfant par modèle** (`--models-max`, `/models`, `/models/load`, `/models/unload`, `--sleep-idle-seconds`). Testé : LFM3-Omni (chat + vision + voix) et granite (embeddings) résidents ensemble avec `--models-max 2`.
- Points d'entrée présents : `/v1/chat/completions`, `/v1/embeddings`, `/v1/audio/speech`, `/v1/audio/transcriptions`, `/v1/realtime` (WebSocket), `/models*`.
- **Cause racine de la lenteur actuelle de Doku** : le `ggml-cpu.dll` livré par Ollama (0.32 **et** 0.40.18, la dernière) est compilé sans les instructions entières du Snapdragon :

  | Build | `system_info` |
  |---|---|
  | Ollama 0.32.0 et 0.40.18 (runner `llama-server.exe` interne) | `NEON = 1 \| ARM_FMA = 1 \| LLAMAFILE = 1 \| REPACK = 1` |
  | llama.cpp b12810 officiel | `NEON = 1 \| ARM_FMA = 1 \| MATMUL_INT8 = 1 \| DOTPROD = 1 \| OPENMP = 1 \| REPACK = 1` |

  Ollama 0.32 **est déjà** un `llama-server` sous une couche Go (journal : `starting llama-server cmd=…lib\ollama\llama-server.exe`). Remplacer Ollama, c'est retirer la couche Go et prendre un `ggml-cpu` compilé avec `DOTPROD`/`MATMUL_INT8`.

## 2. Texte CPU — prefill, decode, RAM

Médianes de 3 runs (chauffe jetée), sortie plafonnée à 400 tokens, fichiers `results/text-*.json`.

| Taille doc | Ollama 0.32 · qwen 1.5b | llama.cpp · qwen 1.5b (même fichier) | llama.cpp · LFM3 Q4_0 | llama.cpp · LFM3 Q4_K_M |
|---|---|---|---|---|
| 1 800 c | 565 tok · **TTFT 6,8 s** (87 t/s) · decode 41,9 t/s | 565 tok · **TTFT 1,5 s** (383 t/s) · 54,8 t/s | 492 tok · TTFT 2,7 s (180 t/s) · 30,1 t/s | 492 tok · 2,8 s · 42,6 t/s |
| 3 600 c | 1 039 tok · **13,9 s** (80 t/s) · 32,5 t/s | 1 039 tok · **3,3 s** (318 t/s) · 50,5 t/s | 927 tok · 7,6 s (123 t/s)¹ · 29,8 t/s | 927 tok · 4,9 s · 30,1 t/s |
| 7 200 c | 1 995 tok · **30,7 s** (66 t/s) · 24,3 t/s | 1 995 tok · **8,7 s** (229 t/s) · 22,0 t/s | 1 797 tok · **7,1 s** (254 t/s) · 29,8 t/s | 1 797 tok · 10,9 s · 19,5 t/s |
| 14 400 c | 3 908 tok · **74,1 s** (53 t/s) · 20,6 t/s | 3 909 tok · **27,6 s** (142 t/s) · 14,5 t/s | 3 546 tok · **15,6 s** (228 t/s) · **23,0 t/s** | 3 546 tok · 23,3 s · 20,0 t/s |
| Bout-à-bout 400 tok @ 14 400 c² | **93,5 s** | 55,2 s | **33,0 s** | 43,3 s |
| Working set crête | 1 973 Mo | 1 932 Mo | 1 894 Mo | 1 791 Mo |

¹ runs de 3,3 s à 8,0 s pour la même requête : bruit de la machine. ² TTFT + 400 / decode.

Lecture :
- **Même modèle, même fichier : llama.cpp prefill 2,7× à 4,5× plus vite qu'Ollama.** Le prefill de 440 tok à ~4,9 s d'ADR-0016 se retrouve aujourd'hui (Ollama, 87 t/s) : la baseline n'a pas bougé, c'est le runtime qui la divise par 4.
- Contrôle au même instant (machine plus chargée) : llama.cpp 1,9-3,1 s / 4,2 s contre **Ollama 0.40.18** 8,5-12,5 s / 21,1 s à 565 / 1 039 tok (`results/text-ollama0.40.18-partiel.txt`, `results/text-llamacpp-qwen-q4_0-controle-*.json`). **Mettre Ollama à jour ne corrige rien.**
- **LFM3 tient mieux la longueur** : decode quasi plat (~30 → 23 t/s de 500 à 3 500 tok) là où qwen s'effondre (55 → 14,5 t/s) — architecture hybride (13 couches convolutives, 11 d'attention seulement). Son tokenizer compte **13 % de tokens en moins** sur le français. Sur un doc court, qwen reste plus rapide.
- **Q4_0 > Q4_K_M** sur ARM (repacking) : la règle « `-q4_0` obligatoire » de la mémoire du copilote vaut aussi pour LFM3.
- **Réglages par défaut de llama.cpp mauvais ici** (premier passage jeté, journal `llama-8090.out.log`) : 10 threads + mmap + 4 slots → decode **9 t/s** avec des chutes à 0,6 t/s. Balayage `llama-bench` (`results/llama-bench.md`) : tg128 = 54 t/s à 4 threads, 23 t/s à 10. **`threads = 4` et `load-mode = none` sont obligatoires.**
- Chargement à froid : 25-36 s pour les deux runtimes quand le fichier n'est pas en cache (SSD USB + pression mémoire) ; non comparable, non concluant.

## 3. Qualité en français

`results/quality-fr.md` (côte à côte) — 8 tâches avec les **prompts réels** de `src/lib/copilot-service.ts` (persona local), mêmes réglages (temp 0,2, top_k 40, top_p 0,9, repeat 1,1, seed 42), même `llama-server`.

| Tâche | LFM3-Omni Q4_0 | qwen2.5 1.5b Q4_0 |
|---|---|---|
| Résumé ADR-0001 | ✅ fidèle (1 approximation) | ❌ résume l'en-tête (date, statut, décideurs) |
| Points clés | ✅ extraits fidèles | ⚠️ génériques + 1 invention (« sans API supplémentaires ») |
| Actions « Next » | ✅ les bonnes actions (pas en cases à cocher) | ❌ liste les concepts, pas les actions, dans un bloc de code |
| Q&A citée (RAG) | ✅ citations [2] [3] exactes | ❌ aucune citation + 2 inventions (« après la coupure », « interruption du réseau ») |
| Q&A piège | ✅ phrase de refus exacte | ✅ phrase de refus exacte |
| Reformuler | ⚠️ dernière phrase illogique | ⚠️ tautologie ajoutée |
| Corriger | ✅ correction minimale exacte | ⚠️ enrobe de `"""` (casse le contrat de remplacement) + synonyme |
| Traduire FR→EN | ✅ propre | ❌ préambule + guillemets (casse le contrat) |

**Verdict qualité : LFM3 nettement au-dessus du 1.5b actuel** (6 ✅ / 2 ⚠️ contre 1 ✅ / 3 ⚠️ / 4 ❌), notamment sur ce qui fait la confiance dans Doku : citations, absence d'invention, respect du « réponds UNIQUEMENT avec le texte ». Limites : un seul tirage, n = 8, jugé par moi et **pas en aveugle** — à confirmer en natif dans Doku avant de trancher (B).

## 4. Documents / vision (mmproj Q8_0)

`results/vision.md`, pages générées par `make-pages.py` (`results/vision/*.png`, vérité terrain connue).

| Page | Question | Résultat | Latence (chaud) |
|---|---|---|---|
| Courrier « numérisé » (penché, bruité) | n° de permis + pièces manquantes | ✅ (n° exact, PCMI2 + PCMI4) | 86 s (inclut le chargement) |
| idem | transcription intégrale | ✅ **mot pour mot** | 41 s (prefill 35 s, 2 040 tok) |
| Tableau de budget | 2 montants | ✅ 3 100 € / 14 320 € | 14 s |
| idem | → tableau Markdown | ✅ 6 × 6 exact | 23 s |
| Formulaire manuscrit | 7 champs en JSON | ✅ 6/7 (`exemple.fr` → `example.fr`) | 22 s |

**Verdict vision : qualité d'OCR/compréhension remarquable pour 2B, latence de 15-40 s par page** (une image coûte 1 200-2 000 tokens de prefill). Utilisable pour « interroger un PDF scanné » page par page, pas pour l'indexation en masse.

## 5. Parole

Fichiers : `results/audio/fr-court.wav`, `results/audio/fr-reponse.wav`, `results/audio/fr-nombres.wav`, `results/audio/fr-nombres-en-lettres.wav` (24 kHz mono). Mesures : `results/speech.json` (2ᵉ passage) et `results/speech-run1.json`.

| Mesure | Valeur |
|---|---|
| TTS `/v1/audio/speech` en flux (`stream_format: audio`, `lang: fr`) — 1er octet audio | **0,36-0,54 s** |
| TTS facteur temps réel | **0,44-0,75** (plus rapide que le temps réel ; 11-12 s d'audio en 5-8 s) |
| ASR `/v1/audio/transcriptions` | 12 s d'audio en 2,7-2,9 s (RTF ≈ 0,24) ; transcription quasi parfaite d'une phrase normale |
| `/v1/realtime` (WebSocket, texte → voix entrelacée) | **fonctionne** : 1er texte 0,37-0,40 s, 1er audio 0,59-0,60 s, séquence d'événements OpenAI complète |

Défauts constatés, recoupés par un ASR indépendant (Whisper small, `results/asr-whisper-crosscheck.json`) :
- **Les chiffres, dates, heures, pourcentages écrits en chiffres sont massacrés à la synthèse** (« 14 octobre 2026 à 9 h 30, salle 212 » → « 4 octobre … salle Ludo's Total »). Deux ASR différents entendent la même bouillie : le défaut est dans le TTS. **Écrits en lettres, aller-retour TTS → ASR parfait** (`tts-nombres.mjs`, `fr-nombres-en-lettres.wav`). Il faut donc une normalisation FR (verbalisation des nombres) avant la synthèse.
- Noms propres déformés : Tauri → « Tori », Doku → « Dokou » / « deux clous ».
- Non testé : conversation vocale micro → `/v1/realtime` (seule l'entrée texte a été envoyée).

**Verdict parole : la voix est réellement exploitable (latence < 0,6 s, plus rapide que le temps réel, français naturel) sous réserve de la normalisation des nombres.** L'ASR est bon.

## 6. Embeddings — parité

Même fichier `granite-embedding:278m` servi par Ollama `/api/embed` et `llama-server /v1/embeddings` (`results/embed-parity.json`).

- Dimensions : **768 = 768** (ce que `rag-index.svelte.ts` stocke).
- Cosinus vecteur à vecteur : **> 0,999999** sur les 6 textes ; écarts sur les similarités de paires ≤ 2·10⁻⁵.
- Débit à chaud (6 textes) : 231 ms contre 510 ms.

**Verdict : parité totale, les index RAG existants restent valides — aucun ré-index à la migration.**

## 7. Voie NPU (ADR-0016)

`LiquidAI/LFM3-Omni-2B-ONNX` est un ensemble de graphes ONNX bruts (decoder, encodeurs vision/audio, depth decoder, codec decoder) pour onnxruntime / transformers.js :
- **pas de `genai_config.json`** → `onnxruntime-genai` ne sait pas le charger ;
- quantification **poids seuls** (`MatMulNBits` int4, ou fp16) — **aucun QDQ** statique int8/int16 comme l'exige le HTP ;
- formes dynamiques (`Shape`, `NonZero`, `ScatterND`) et opérateurs contrib `GroupQueryAttention`, `RotaryEmbedding`, `MatMulNBits`, plus 13 `Conv` de cache convolutif.

Essai réel (recette npu-17.1 : Python ARM64 3.13.17 + `onnxruntime-qnn` 2.8.0 / ORT 1.32 en EP plugin + `ADSP_LIBRARY_PATH`, `qnn-probe.py`) sur `decoder_q4.onnx` : le NPU est bien découvert, mais **sans repli CPU la session est refusée** ; avec repli, le QNN EP ne prend que **46 nœuds sur 749** (13 partitions, toutes de l'arithmétique de formes ; binaire de contexte de 508 Ko) — **0 des 154 `MatMulNBits`, 0 attention, 0 `Conv`**. Tout le calcul reste sur CPU : rien à mesurer côté NPU.

Conditions de réouverture d'ADR-0016, factuellement :
1. *3B QNN genai francophone publié* : **non**. Aucune variante QNN de LFM3 ; recherche Hugging Face du 2026-11-27 (« qnn », « npu », « htp ») : binaires de contexte pour SoC mobiles (SM8550/8750), Qwen3.5 9B, rien de ~3B genai FR pour Snapdragon X.
2. *≥ 32 Go* : non (inchangé).
3. *Runtime prefill-NPU / decode-CPU* : **non sur Windows**. llama.cpp a un backend Hexagon, mais ses builds ne sortent que pour Android et Linux Snapdragon ; ORT ne sait toujours pas découper un graphe ainsi.

**ADR-0016 reste fermé.** Le gain de prefill que le NPU promettait (4-6×) est obtenu ici **sur CPU**, en changeant de build.

## 8. Réseau / hors ligne

| Contrôle | Résultat |
|---|---|
| Piège à proxy (`proxy-trap.mjs` : `HTTPS_PROXY`/`HTTP_PROXY` → 127.0.0.1:8098) — **témoin positif** : `-hf` sans `--offline` | **capté** : `CONNECT huggingface.co:443` → le capteur voit bien les sorties de llama.cpp |
| Même piège, **cycle complet** : routeur, chargement LFM3 + mmproj + granite, TTS ×3, ASR ×2, realtime, embeddings | **0 tentative** (`results/offline-proxy-trap.txt`) |
| `-hf` **avec** `--offline` | échoue en 14 ms sans requête (sans `--offline` : appel HF à 450 ms) — `results/offline-controles-hf.txt` |
| Sondage TCP du process toutes les 200 ms (`netwatch.ps1`) | 0 connexion, **mais aveugle** : il a raté le témoin positif (requête de 450 ms). Non compté comme preuve |

Limite : pas de droits admin → pas de `pktmon` ; un client qui ignorerait `HTTPS_PROXY` échapperait au piège. Analyse statique des binaires : les seules URLs réseau servent à `-hf`/`--hf-*`, `-dr` (registre Docker), `--mmproj-url`, `llama update`/`download`, les préréglages `--*-default`, et l'UI web.

**Verdict : hors ligne OK si Doku passe des chemins locaux et `--offline`, et n'expose jamais** `-hf`, `--mmproj-url`, `llama update`, l'UI (`--no-ui`). Deux réglages de sécurité à poser, absents par défaut : `--cors-origins http://tauri.localhost` (défaut `*`, le serveur le signale au démarrage) et ne jamais transmettre d'`image_url` http(s) (le serveur va chercher les URLs **publiques** par défaut ; Doku n'envoie que des `data:`).

## Recommandations

### (A) Remplacer Ollama par llama.cpp — **OUI**, en story dédiée

Faits : prefill **×2,7 à ×4,5** sur le même fichier, decode égal ou meilleur à 4 threads, RAM identique, embeddings identiques au bit près, binaire de 13 Mo (contre 32 Mo + `lib/` pour Ollama Windows, 1,44 Go pour l'archive Linux), voix et vision disponibles. La douleur « ~45 s avant le 1er token » d'ADR-0016 était surtout **un défaut de compilation d'Ollama ARM64**, que sa dernière version n'a pas corrigé.

Ce qu'on perd et qu'il faut reconstruire : la gestion de modèles d'Ollama (`/api/pull` sur son registre, `/api/tags`, `/api/delete`, manifestes). Le routeur fournit liste / chargement / déchargement ; le **téléchargement** (fichier GGUF + mmproj depuis Hugging Face, vérification sha256, action réseau explicite) devient du code Doku.

Risques :
- **Défauts de llama.cpp dangereux ici** (10 threads, mmap, 4 slots → decode ÷5) : Doku doit imposer `threads`, `load-mode none`, `parallel 1`. Leçon générique : un défaut de runtime n'est pas un réglage.
- **Instabilité des options** : `no-mmap` refusé dans un preset, `--webui` déprécié pour `--ui`, build quotidien. Épingler un build, test de fumée à chaque montée.
- Sécurité : CORS `*` par défaut, pas de clé, fetch d'URLs publiques (voir §8).
- Le routeur est récent ; `--models-max`/`--models-memory-margin` à valider sur la vraie cohabitation chat + embeddings + WebView2 (mesuré ici : LFM3 omni 2,2 Go + granite 0,7 Go).
- Migration des modèles déjà téléchargés : les blobs Ollama **sont** des GGUF (ce spike les a servis tels quels) → relire les manifestes et réutiliser les fichiers, sans re-télécharger.
- Linux : plus d'Ollama système ; empaqueter le build `ubuntu-x64` (quelques dizaines de Mo) au lieu de dépendre du paquet — inverse le raisonnement d'ADR-0025, qui reposait sur les 1,44 Go d'Ollama.

Esquisse de migration (modules touchés) :
1. `src-tauri/src/sidecar.rs` : lancer `llama-server` en routeur (`--models-preset` généré dans `app_data_dir`, `--offline`, `--no-ui`, `--cors-origins`, `threads`, `load-mode`) ; port éphémère et **Job Object inchangés** (les enfants du routeur héritent du job, comme le runner d'Ollama). `main.rs`, `capabilities/default.json`, `tauri.conf.json` / `tauri.linux.conf.json` (externalBin + resources), `src-tauri/binaries/` + `scripts/prepare-ollama-sidecar.mjs` → `prepare-llama-sidecar.mjs`, `package.json`, workflows `ci.yml`, `build-windows-x64.yml`, `build-linux-x64.yml`, `packaging/arch/PKGBUILD`.
2. `src/lib/ollama.ts` → client OpenAI-compatible : SSE `/v1/chat/completions` (remplace NDJSON `/api/chat` et `/api/generate`), `/v1/embeddings`, `/models` (+ load/unload) ; `options.num_ctx` → contexte par modèle dans le preset ; `keep_alive` → `--sleep-idle-seconds` / unload ; `ollama.test.ts`.
3. `src/lib/copilot.svelte.ts`, `src/lib/rag-index.svelte.ts`, `src/components/CopilotPanel.svelte`, `src/components/TitleIsland.svelte`, vue Modèles de `SettingsDialog.svelte` : nouveau flux de téléchargement / suppression (fichiers + mmproj), reprise des blobs Ollama existants.
4. ADR nouveau, qui supersède le moteur d'ADR-0006, les détails de cycle de vie d'ADR-0012 et le choix Linux d'ADR-0025.

### (B) LFM3-Omni-2B

- **Modèle texte par défaut : candidat sérieux, pas encore tranché.** Qualité FR nettement supérieure au 1.5b sur les tâches Doku (citations, refus, contrats de sortie), RAM équivalente (1,9 Go en texte seul), et **plus rapide que le 1.5b actuel sous Ollama** sur tous les documents (TTFT 2,7 s contre 6,8 s à 1 800 c ; 33 s contre 94 s bout-à-bout à 14 400 c). Face au même qwen sous llama.cpp, il est plus lent sur les documents courts et plus rapide dès ~2 000 tokens. Critère « gadget discret » respecté. Avant de basculer : gate qualité **en aveugle et en natif dans Doku** (protocole ADR-0016), avec Q4_0 uniquement. Licence LFM Open v1.0 : gratuite sous 10 M$ de CA, redistribution permise avec la licence jointe.
- **Modèle vision : oui** (OCR de scans, tableaux, formulaires : excellent ; 15-40 s/page). Il comble la limite assumée de l'Epic 18 (`docs/planning/epics.md` : « PDF scanné signalé honnêtement (pas d'OCR) »).
- **Modèle voix : oui, sous conditions** : normalisation FR des nombres avant TTS (sinon chiffres faux), RAM +0,3 Go pour le mmproj (2,2 Go au total). Un seul modèle couvre chat, vision, ASR et TTS : un seul process résident.
- Ordre conseillé : (A) d'abord (gain mesuré, sans risque qualité, à modèle constant), puis (B) texte après le gate en aveugle, puis vision et voix comme fonctionnalités.

## Files

| Fichier | Rôle |
|---|---|
| `bench-text.mjs` | Banc prefill/decode/TTFT/RAM crête, corpus `../npu-17.1/longdoc.mjs`, préfixe unique anti-cache |
| `quality-fr.mjs` | Gate qualité FR, 8 tâches aux prompts de `copilot-service.ts` |
| `make-pages.py` / `vision.mjs` | Pages PNG à vérité terrain + questions vision |
| `speech.mjs` / `tts-nombres.mjs` | TTS en flux, ASR, sonde `/v1/realtime` ; aller-retour nombres en lettres |
| `embed-parity.mjs` | Parité granite Ollama ↔ llama.cpp |
| `qnn-probe.py` | Essai HTP du decoder ONNX (Python ARM64) |
| `proxy-trap.mjs` / `netwatch.ps1` | Preuves réseau (piège à proxy ; sondage TCP, aveugle aux connexions courtes) |
| `models.ini` | Preset du routeur llama-server |
| `results/` | Mesures brutes (JSON), sorties qualité/vision (MD), WAV, preuves réseau |
| `.cache/` | Binaires, modèles, venv, journaux — ignoré par git (`.gitignore`) |

## Dependencies

- **Internal** : `../npu-17.1/longdoc.mjs` (corpus), `../corpus/` (documents des tâches qualité), `src-tauri/binaries/` (Ollama 0.32 de référence).
- **External** : llama.cpp b12810, Node ≥ 22 (fetch, WebSocket, FormData), Python 3.13 x64 avec Pillow (pages) et faster-whisper (contre-ASR), Python ARM64 (nuget `pythonarm64` 3.13.17) avec `onnxruntime-qnn` 2.8.0.
