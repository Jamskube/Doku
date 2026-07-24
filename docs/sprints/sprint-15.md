# Sprint 15

**Goal** : **trancher le NPU par la mesure** — prouver (ou réfuter) que Foundry Local + QNN effondre le prefill (~45 s → ~1-2 s) sur ce Snapdragon X **Plus**, sans casser le 0-réseau, **avant** d'engager la réécriture du sidecar.
**Start** : 2026-07-24
**End** : 2026-07-31
**Status** : Active

Sprint **spike-first** (Epic 17, backend d'inférence NPU). C'est le **dernier epic du backlog** : Epics 1–16 + 18 sont livrés (ledger 63/63), le produit est feature-complete côté v2.2. L'Epic 17 était une « piste » (urgence rétrogradée le 2026-07-16) ; le choix produit du 2026-07-24 est de **l'attaquer maintenant**, en sautant le préalable CPU (assumé). La livraison se mesure en **décision tranchée**, pas en nombre de stories : un **NO-GO documenté est une livraison**.

Rappels de cadrage :
- **0 réseau = contrainte dure** (NFR Confidentialité) : Foundry Local est 100 % local, mais son EP QNN + l'activation des modèles ONNX doivent être **re-prouvés** sans requête non-`localhost` (y compris au premier chargement).
- **Gain étroit par nature** : le NPU effondre le **prefill** mais **décode plus lentement** que le CPU en q4_0 (benchmark : NPU 19,5 t/s < CPU q4_0 36,3 t/s). Le spike doit confirmer que le gain prefill vaut la complexité.
- **Exclus** : OmniNeural-4B / Nexa (anglais + activation en ligne obligatoire = casse le 0-réseau). Modèle visé : vrai 4B texte FR (Qwen3-4B / Ministral-3) en ONNX.
- **Abstraction, pas remplacement** : viser une couche d'inférence commutable (Ollama ⇄ Foundry), pas un remplacement sec d'Ollama.

## Stories

| # | Story | Size | Status | Gate | Notes |
|---|-------|------|--------|------|-------|
| 17.1 | Spike Foundry Local : mesure prefill NPU vs CPU + re-preuve 0-réseau → ADR-0016 GO/NO-GO | M | TODO | **STOP/GO** | Sidecar QNN sur ce SoC, prefill chiffré sur long doc réel, 0 réseau monitoré, faisabilité client OpenAI. Verdict tranché par la donnée avant tout code de prod. |
| 17.2 | Abstraction couche d'inférence (Ollama ⇄ Foundry) + client OpenAI | L | 🔒 Gated | déverrouillée **si 17.1 = GO** | Réécriture lourde : nouveau sidecar ONNX, client OpenAI `/v1/chat/completions`, re-packaging ARM64, 0 réseau re-prouvé. Non codée tant que 17.1 n'a pas tranché GO. |

## Blockers
_None_

## Checkpoints STOP/GO
| ~% | Critère | Si STOP |
|---|---|---|
| 100 % (17.1) | Prefill mesuré (NPU vs CPU, chiffres), 0 réseau prouvé, faisabilité client OpenAI, **ADR-0016 avec verdict GO/NO-GO** | **NO-GO** = livraison valide : documenter que le gain prefill ne vaut pas la complexité → **repli sur le levier CPU** (câbler + mesurer `qwen2.5:3b-instruct-q4_0` comme défaut). 17.2 abandonnée, Epic 17 re-noté « piste, préalable CPU d'abord ». |
| — (17.2) | Ne démarre **que** sur un GO de 17.1 | Si 17.1 = NO-GO : 17.2 n'est pas ouverte du tout. |

## Progress Log
### 2026-07-24
- Sprint initialisé avec **2 stories** (Epic 17, backend NPU), décomposé spike-first. Ledger : +2 entrées (65 features, 2 ouvertes : 17.1, 17.2).
- **17.2 gated** : ne se code que si le spike 17.1 tranche GO. Un NO-GO documenté clôt le sprint honnêtement (repli levier CPU).
- Choix produit : préalable « épuiser le levier CPU » **sauté** (assumé) — le spike mesurera si le prefill justifie même le NPU. Direction Foundry Local (ONNX/QNN), pas OmniNeural/Nexa (casse le 0-réseau).
