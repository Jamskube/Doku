# 0016. Backend d'inférence NPU via Foundry Local — cadre de décision (spike 17.1)

**Date** : 2026-07-24 · **Status** : proposed (verdict GO/NO-GO en attente des mesures 17.1) · **Deciders** : nicos (+ Claude) · **Tags** : ia, llm, npu, qnn, foundry-local, arm64, perf, copilote

> ⏳ **ADR vivant.** Il fige le **cadre de décision et les seuils AVANT de mesurer** (anti-rationalisation post-hoc). Le spike 17.1 (`spike/npu-17.1/`) remplit la section « Mesures » sur la Surface Pro 11 réelle, puis le **Status** passe à `accepted` (GO) ou `rejected` (NO-GO). Successeur explicitement prévu par [ADR-0006](./0006-copilote-ia-ollama-sidecar-cpu.md) (« toute piste NPU future … exigera son propre ADR »).

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

## Mesures (spike 17.1 — À REMPLIR sur la machine réelle)

> Protocole complet : `spike/npu-17.1/README.md`. Comparaison **B** = décision (stack réelle CPU `qwen2.5:3b-q4_0` vs contender NPU). Comparaison **A** (même modèle 7B des deux côtés) = **informative** seulement (quantifications Q4 vs INT8 différentes → ne prouve pas un « speedup hardware pur »).

| Métrique | CPU baseline (`qwen2.5:3b-q4_0`) | Contender NPU (`________`) |
|---|---|---|
| Quantification | Q4_0 | _____ (INT8 ?) |
| Cold-start TTFT (load + compile QNN, jeté) | _____ | _____ |
| TTFT @ ~4000 tok (prefill) | _____ s | _____ s |
| Pente prefill (ms/tok d'entrée, 500→8000) | _____ | _____ |
| Decode tok/s | _____ | _____ |
| **Bout-à-bout, réponse 400 tok** | _____ s | _____ s |
| **Croisement L\*** (tokens de sortie où le NPU cesse de gagner) | — | _____ tok |
| RAM crête (working set) | _____ Go | _____ Go |
| Qualité FR en aveugle (≥ baseline ?) | référence | _____ |
| 0-réseau (pktmon plein cycle + cold-load air-gap) | N/A | _____ (OK / cassé) |

## Grille GO/NO-GO (seuils PRÉ-ENREGISTRÉS — ne pas bouger après mesure)

GO **seulement si TOUS** vrais :
1. TTFT NPU @ 4000 tok **< 5 s** ET **≥ 3×** plus rapide que CPU.
2. Bout-à-bout 400 tok NPU **< CPU** ET **L\* > 800** tokens.
3. 0-réseau : capture pktmon **sans egress non-loopback** ET cold-load air-gap fonctionnel.
4. Qualité FR contender **≥** baseline (aveugle).
5. RAM crête **< 12 Go**.
6. DLLs QNN/Qualcomm **redistribuables** en bundle.

**Un seul échec → NO-GO.**

## Decision

⏳ **En attente des mesures 17.1.** Le cadre ci-dessus est figé ; le verdict sera l'un des deux :

- **GO** → `accepted` : ouvrir 17.2 (abstraction couche d'inférence Ollama ⇄ Foundry via le `ProviderRuntime` existant de `copilot.svelte.ts` + client OpenAI, précédent ADR-0014). Consigner les chiffres qui justifient la complexité.
- **NO-GO** → `rejected` : repli documenté sur le **levier CPU** (`qwen2.5:3b-instruct-q4_0` comme défaut copilote — le préalable sauté au sprint 15). Epic 17 re-noté « piste, préalable CPU d'abord ». **Un NO-GO chiffré est une livraison valide du spike.**

## Consequences

**Positive (si GO)** : prefill effondré (~45 s → ~1-2 s) sur longs docs ; le NPU inexploité enfin mis à profit ; abstraction d'inférence réutilisable (Ollama ⇄ Foundry ⇄ OpenAI cloud).
**Negative (si GO)** : 2ᵉ sidecar volumineux à empaqueter ; re-packaging ARM64 ; changement de modèle (impact qualité/RAM) ; surface de maintenance doublée.
**Risks** :
- **0-réseau cassé au provisioning** (#275) → gate DUR : NO-GO si l'air-gap post-provisioning n'est pas prouvé.
- **Bilan net négatif** : decode NPU plus lent + pas de split → un long résumé peut être *plus lent* qu'en CPU (capté par L\* et le bout-à-bout).
- **Maturité QNN fragile** sur Surface Pro 11 (#259, #244) → risque d'instabilité même en cas de gain.
- **Licence DLLs Qualcomm** non redistribuable → showstopper juridique indépendant de la perf.

## Related

- [ADR-0006](./0006-copilote-ia-ollama-sidecar-cpu.md) — a écarté le NPU (driver batterie) ; **prévoit ce successeur** ; driver ici = latence de prefill (neuf)
- [ADR-0012](./0012-cycle-de-vie-sidecar-ollama.md) — cycle de vie sidecar (Job Object) à imiter pour un 2ᵉ sidecar Foundry
- [ADR-0014](./0014-connexion-compte-openai-codex.md) — précédent d'un provider non-Ollama (streaming, secret hors webview) ; le `ProviderRuntime` existant accueille Foundry
- [ADR-0015](./0015-stack-rag-embeddings-locaux.md) — l'embedding RAG reste Ollama (hors scope NPU chat)
- `spike/npu-17.1/` — banc de mesure + protocole + preuve 0-réseau
- `docs/sprints/sprint-15.md` — stories 17.1 (ce spike) / 17.2 (gated GO)
- Mémoires `piste-backend-npu`, `upgrade-modele-copilote`
