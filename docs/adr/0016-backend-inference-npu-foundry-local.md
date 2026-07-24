# 0016. Backend d'inférence NPU (Foundry Local / QNN) — NO-GO mesuré (spike 17.1)

**Date** : 2026-07-24 · **Status** : **rejected** (NO-GO mesuré — spike 17.1) · **Deciders** : nicos (+ Claude) · **Tags** : ia, llm, npu, qnn, foundry-local, arm64, perf, copilote

> ✅ **Verdict rendu le 2026-07-24 : NO-GO.** Le cadre et les seuils ci-dessous ont été figés **avant** de mesurer (anti-rationalisation post-hoc) ; les mesures réelles sur la Surface Pro 11 sont consignées telles quelles. **Le NPU fonctionne** (voie ORT-genai-QNN directe, découverte pendant le spike), mais il **échoue la grille** sur cette machine. Le copilote **reste sur Ollama CPU**, modèle `qwen2.5:1.5b-instruct-q4_0`. Successeur explicitement prévu par [ADR-0006](./0006-copilote-ia-ollama-sidecar-cpu.md) (« toute piste NPU future … exigera son propre ADR »).

## Context

Le copilote (ADR-0006) tourne **CPU-only** via Ollama : le NPU Hexagon du Snapdragon X ne consomme que de l'ONNX/QNN pré-compilé, jamais du GGUF. ADR-0006 a écarté le NPU en jugeant que son **seul** gain était l'autonomie batterie — et ne rouvrait le dossier que « si l'autonomie batterie devient un objectif produit explicite ».

**Ce driver a changé.** L'usage réel (v2.0 → v2.2) a révélé une douleur que 0006 n'avait pas pesée : **~45 s de prefill** avant le 1er token sur les longs documents (résumé / Q&A / RAG). Le prefill est *compute-bound* et **massivement parallèle** — exactement ce que le NPU accélère (là où le decode, *memory-bound*, ne gagne rien). Le nouveau driver est donc **la latence de prefill**, pas la batterie. C'est une réouverture légitime.

Direction pressentie (mémoire `piste-backend-npu`) : **Microsoft Foundry Local** (ONNX Runtime + execution provider QNN), lancé en sidecar comme `ollama.exe`, **API HTTP compatible OpenAI** `/v1/chat/completions`, 100 % local. Exclus : OmniNeural-4B / Nexa (activation en ligne obligatoire = casse le 0-réseau).

**Machine réelle** : Surface Pro 11, Snapdragon X **Plus** (pas Elite — ADR-0006 disait « Elite » par erreur ; le NPU Hexagon est **45 TOPS INT8 identique** sur Plus et Elite, donc sans incidence sur la faisabilité NPU), 16 Go RAM partagés (pas de VRAM dédiée), **fanless**.

## Decision drivers

- **Latence de prefill** : effondrer les ~45 s d'attente avant le 1er token (le vrai irritant).
- **0 réseau = contrainte DURE** (NFR Confidentialité) : ni à l'inférence, ni à l'activation. Critère **éliminatoire**.
- **Bilan net, pas prefill nu** : le NPU **décode plus lentement** que le CPU q4_0, et Foundry Local **ne sait pas** faire prefill-NPU/decode-CPU (un seul EP pour tout le modèle). Le gain prefill peut être **mangé** par le decode sur une réponse longue.
- **Qualité FR** : le NPU impose de **changer de modèle** (aucun build QNN de `qwen2.5:3b-q4_0`) → le contender doit rester **≥** en français.
- **Coût d'intégration** : 2ᵉ sidecar ONNX + client OpenAI + gestion modèles ONNX + re-packaging ARM64 + re-preuve 0-réseau. Lourd — ne s'engage (17.2) que sur un GO chiffré.
- **Rust minimal** (ADR-0004) : préservable (sidecar, comme Ollama).

## Faisabilité préliminaire (recherche externe, 2026-07-24 — avant mesure)

| Question | Réponse | Confiance |
|---|---|---|
| Foundry Local existe en Windows ARM64 ? | **Oui**, GA avril 2026, `winget install Microsoft.FoundryLocal`, tourne sur Surface Pro 11 | élevée |
| Endpoint OpenAI `/v1/chat/completions` streamé ? | **Oui**, port dynamique via `foundry service status` | élevée |
| NPU/QNN routé sur X Plus ? | **Oui en principe** (45 TOPS = Elite) ; **maturité fragile** (bugs #259 modèles NPU disparus, #244 erreur 5005) | moyenne |
| Vrai 4B FR en QNN ? | **Non** — pas de Ministral-3/Qwen3-4B QNN. Plus proche : `qwen2.5-7b-instruct-qnn-npu` (7B, FR correct) ou `phi-4-mini-qnn-npu` (~3,8B, FR faible). **Passer au NPU = changer de modèle** | moyenne-élevée |
| 0 réseau prêt-à-l'emploi ? | **Incertain** — régression #275 (dépendance catalogue en ligne post-install), QNN EP téléchargé dynamiquement via Windows ML. Au mieux « online une fois puis air-gap ». Pas de login/activation obligatoire | moyenne |
| Gain prefill ~18× confirmé sur X Plus ? | **Non étayé** — aucun benchmark X Plus public. Decode NPU < CPU q4_0 : **confirmé comme risque** | faible |
| DLLs Qualcomm redistribuables ? | **Non confirmé** — SDK MIT, mais DLLs QNN/Qualcomm sous termes propres. À vérifier juridiquement | faible |

## Mesures (spike 17.1 — machine réelle, 2026-07-24)

### Résultat préalable : Foundry Local est HORS JEU

`foundry model load qwen2.5-1.5b-instruct-qnn-npu` → `QNN SetupBackend failed`. Logs : `AutoRegisterCertifiedEps: Failure` (« Unknown EP bootstrapper name(s) »). Le SDK (`FoundryLocalManager.discoverEps()`) ne retourne **que WebGpu** — le QNN n'est même pas *découvrable* ; `downloadAndRegisterEps(['QNN'])` est un no-op silencieux ; `.foundry/ep/` ne contient que `webgpu-ep`. 0.10.2 = dernière version. **Le chemin pressenti par l'ADR n'existe pas sur cette machine.**

### La voie qui marche (découverte du spike, hors Foundry)

**`onnxruntime-genai` + `onnxruntime-qnn` en direct** (paquets pip, DLLs Qualcomm officielles) : `og.register_execution_provider_library("QNNExecutionProvider", …)` + `Config.append_provider(…)` + **`ADSP_LIBRARY_PATH`** vers les libs (sinon `load library failed`). Le modèle charge réellement sur le HTP Hexagon en ~4-5 s et génère du français cohérent. Artefacts : `spike/npu-17.1/sidecar/npu_server.py` (endpoint OpenAI streamé servi par le NPU). **Le NPU fait donc bien tourner un LLM — la question devient « à quel prix ».**

### Chiffres (comparaison A : même modèle des deux côtés, `qwen2.5-1.5b`)

| Métrique | CPU (Ollama, q4_0) | NPU (QNN, INT4/INT8) |
|---|---|---|
| Quantification | Q4_0 (repack ARM KleidiAI) | quantif QNN vendeur (plus agressive) |
| Cold-start (chargement + compile QNN, jeté) | ~1 s | **~4-5 s** |
| Prefill @ 440 tok d'entrée | ~4 900 ms | **1 244 ms** (≈ 4×) |
| Prefill @ 786 tok d'entrée | ~10 900 ms | **1 779 ms** (≈ 6×) |
| Pente prefill | ~16 ms/tok, **super-linéaire** | **~1,5 ms/tok, quasi plate** |
| Decode | **44-48 tok/s** | 22-25 tok/s (**~2× plus lent**) |
| RAM | tient large | tient (~1,5 Go de poids) |
| Qualité FR (jugée en natif dans Doku) | référence acceptable | **REJETÉE** — nettement plus bête, boucles de répétition sans `repetition_penalty` |

### Chiffres (le contender « qualité » : `qwen2.5-7b-instruct-onnx-qnn`, llmware)

| Métrique | Valeur | Commentaire |
|---|---|---|
| Poids / RAM | ~4 Go sur disque, **~5 Go résident** | **swap** sur 16 Go partagés ; **a OOM une fois** au chargement |
| Prefill | **10 565 ms** | l'avantage NPU est **annulé** par la pression mémoire |
| Decode | **7,8 tok/s** | ~6× plus lent que le CPU 1.5b |
| Bout-à-bout | **~4× plus lent** que le CPU `1.5b-q4_0` | le « bon » modèle NPU est le plus lent de tous |
| Qualité FR | **bonne** | le seul qui tienne la comparaison… et le seul inutilisable |

### Le trou dans le catalogue

**Aucun modèle 3B QNN genai francophone public** : le catalogue saute **1,5B → 7B**. (`llama-3.2-3b-qnn` existe mais son FR est faible — déjà éliminé sur preuves dans [[upgrade-modele-copilote]].) Il n'existe donc **pas de point de fonctionnement** entre « tient en RAM mais trop bête » et « bon mais swappe ».

### Non mesuré (devenu sans objet)

- **0-réseau (pktmon plein cycle + cold-load air-gap)** : non exécuté. Le NO-GO est tombé sur les axes qualité/RAM avant ce gate. À noter : la voie ORT directe serait **plus favorable** que Foundry (DLLs empaquetables, aucun téléchargement dynamique d'EP).
- **Comparaison B contre `qwen2.5:3b-q4_0`** : sans objet — la baseline produit réelle est le **1.5b** (choix utilisateur du 2026-07-16 : copilote « gadget discret »), et le 3b a été re-rejeté le 2026-07-24 (trop lent, trop de RAM). C'est le 1.5b CPU qui sert de référence ci-dessus.
- **Licence de redistribution des DLLs Qualcomm** : non tranchée (sans objet).

## Grille GO/NO-GO (seuils PRÉ-ENREGISTRÉS — ne pas bouger après mesure)

GO **seulement si TOUS** vrais :
1. TTFT NPU @ 4000 tok **< 5 s** ET **≥ 3×** plus rapide que CPU.
2. Bout-à-bout 400 tok NPU **< CPU** ET **L\* > 800** tokens.
3. 0-réseau : capture pktmon **sans egress non-loopback** ET cold-load air-gap fonctionnel.
4. Qualité FR contender **≥** baseline (aveugle).
5. RAM crête **< 12 Go**.
6. DLLs QNN/Qualcomm **redistribuables** en bundle.

**Un seul échec → NO-GO.**

### Verdict contre la grille

| # | Seuil pré-enregistré | Résultat | Verdict |
|---|---|---|---|
| 1 | TTFT < 5 s ET ≥ 3× plus rapide | 1,2-1,8 s, 4-6× plus rapide (1.5b) | ✅ **PASSE** |
| 2 | Bout-à-bout 400 tok NPU < CPU ET L\* > 800 | decode 2× plus lent → le gain prefill est mangé bien avant 400 tok de sortie ; 7b = ~4× plus lent bout-à-bout | ❌ **ÉCHEC** |
| 3 | 0-réseau prouvé | non mesuré (sans objet) | ⚪ n/a |
| 4 | Qualité FR ≥ baseline | 1.5b-qnn **rejeté en natif** ; seul le 7b tient, et il est inutilisable | ❌ **ÉCHEC** |
| 5 | RAM crête < 12 Go | 1.5b OK ; **7b → swap + OOM** sur 16 Go partagés | ❌ **ÉCHEC** (sur le seul modèle de qualité suffisante) |
| 6 | DLLs redistribuables | non tranché (sans objet) | ⚪ n/a |

**3 échecs sur les 4 seuils atteignables → NO-GO.**

## Decision

**NO-GO. Le copilote reste sur Ollama CPU avec `qwen2.5:1.5b-instruct-q4_0`.** L'Epic 17 est **clos**, la story 17.2 (abstraction Ollama ⇄ Foundry) est **annulée** — sa gate ne s'est pas ouverte.

**La raison n'est pas que le NPU est lent — c'est qu'il n'a pas de point de fonctionnement sur cette machine.** Le NPU gagne exactement là où la théorie le prédisait (prefill, 4-6×, pente plate) et perd là où elle le prédisait (decode, 2×). Mais le choix de modèle est un **étau à trois branches** : le 1,5B QNN tient en RAM et est trop bête ; le 7B QNN est bon et swappe ; **le 3B QNN qui aurait pu concilier les deux n'existe pas**. Aucune quantité d'ingénierie de notre côté ne desserre cet étau — il faudrait soit 32 Go de RAM, soit un modèle qui n'est pas publié.

**Corollaire produit (2026-07-24) : le repli « levier CPU 3b » est lui aussi écarté.** L'ADR prévoyait de basculer le défaut sur `qwen2.5:3b-instruct-q4_0` en cas de NO-GO. L'utilisateur l'a re-testé et tranché : **trop lent et trop gourmand en RAM** pour un copilote qui doit rester un **gadget discret** (cadrage du 2026-07-16). **`qwen2.5:1.5b-instruct-q4_0` est confirmé comme le bon modèle** — l'arbitrage vitesse/discrétion prime sur la qualité brute. Le 3b reste installable en un clic pour les usages où la qualité compte.

**Ce que le spike laisse derrière lui** (valeur réelle d'un NO-GO) :
- `spike/npu-17.1/sidecar/npu_server.py` — **une recette NPU qui marche**, reproductible, prête à re-mesurer sur une future machine ≥ 32 Go ou dès qu'un 3B QNN FR est publié.
- `spike/npu-17.1/bench.mjs` — banc TTFT/decode/croisement L\*, réutilisable pour tout futur backend.
- La certitude que **Foundry Local n'est pas le chemin** (bug amont, pas notre config) — 2 jours d'investigation qu'on ne refera pas.

### Conditions de réouverture

Ne rouvrir l'Epic 17 que si **l'une** de ces conditions est remplie :
1. Un modèle **~3B QNN genai avec un bon français** est publié (le trou du catalogue se comble).
2. La machine cible passe à **≥ 32 Go** de RAM (le 7B cesse de swapper → l'étau se desserre).
3. Un runtime sait faire **prefill-NPU / decode-CPU** sur le même modèle (aujourd'hui impossible : un seul EP par graphe).

## Consequences

**Positive** : aucune complexité ajoutée — pas de 2ᵉ sidecar, pas de re-packaging ARM64, pas de surface de maintenance doublée, le 0-réseau reste prouvé tel quel (ADR-0006/0012 intacts). Le backlog est **vide** : Epics 1-16 + 18 livrés, Epic 17 clos par la mesure. Le NPU a été tranché **par la donnée** en une journée, pas par intuition ni par un chantier de plusieurs semaines abandonné en cours de route.

**Negative** : le prefill long-doc reste à la charge du CPU (irritant non résolu — mais mesuré comme non résoluble ici) ; le NPU Hexagon reste inexploité ; le travail d'intégration du provider `'npu'` dans l'app est retiré du produit (il survit dans `spike/npu-17.1/`).

**Risques du NO-GO** :
- **Décision datée par la machine, pas par le principe** : elle est vraie sur *cette* Surface Pro 11 à 16 Go. Les 3 conditions de réouverture ci-dessus sont là pour éviter qu'un « non » de 2026 devienne un dogme.
- **Recette périssable** : `onnxruntime-genai` / `onnxruntime-qnn` bougent vite ; la recette du sidecar pourrait ne plus s'appliquer telle quelle dans 6 mois. Les versions exactes sont épinglées dans `spike/npu-17.1/sidecar/requirements.txt`.

**Risques éteints par le NO-GO** (ils étaient bien réels) : 0-réseau cassé au provisioning (#275) ; bilan net négatif du decode ; maturité QNN fragile (#259, #244 — **confirmée**, l'EP ne s'enregistre même pas) ; licence des DLLs Qualcomm.

## Related

- [ADR-0006](./0006-copilote-ia-ollama-sidecar-cpu.md) — a écarté le NPU (driver batterie) ; **prévoit ce successeur** ; driver ici = latence de prefill (neuf)
- [ADR-0012](./0012-cycle-de-vie-sidecar-ollama.md) — cycle de vie sidecar (Job Object) à imiter pour un 2ᵉ sidecar Foundry
- [ADR-0014](./0014-connexion-compte-openai-codex.md) — précédent d'un provider non-Ollama (streaming, secret hors webview) ; le `ProviderRuntime` existant accueille Foundry
- [ADR-0015](./0015-stack-rag-embeddings-locaux.md) — l'embedding RAG reste Ollama (hors scope NPU chat)
- `spike/npu-17.1/` — banc de mesure + protocole + preuve 0-réseau
- `docs/sprints/sprint-15.md` — stories 17.1 (ce spike) / 17.2 (gated GO)
- Mémoires `piste-backend-npu`, `upgrade-modele-copilote`
