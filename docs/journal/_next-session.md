# Next session pointer
_Updated: 2026-07-24 17:00_

## Where I left off
Session marathon. **Rétro S14 faite** (3/3), **Sprint 15 planifié** (Epic 17 NPU), puis le **spike 17.1 a viré en grosse investigation NPU** menée jusqu'au bout sur la vraie machine. Résultat : **le NPU MARCHE pour l'inférence LLM — mais PAS via Foundry Local** (son EP QNN est cassé sur X Plus 0.10.2). La voie qui marche = **onnxruntime-genai + onnxruntime-qnn EN DIRECT** (recette dans la mémoire `piste-backend-npu` + `spike/npu-17.1/sidecar/`). Mesuré : prefill 4-6× plus rapide, decode 2× plus lent. **Mais verdict pratique NO-GO sur 16 Go** : le 1.5b-qnn est trop bête (rejeté en natif par l'utilisateur dans Doku), le 7b-qnn est bon mais swappe (~5 Go → prefill 10,6 s, decode 7,8 t/s), et **il n'existe pas de 3B QNN** pour le juste milieu.

## Open work
- Branch: `main` (propre, tout commité ; **à pousser** : `50cc9a5`, `7f3ed50`, `d0c50c4`, `d85e9cf`)
- Open PRs: aucune
- **Sprint 15 : Active** — 17.1 (spike) codé/mesuré mais **ledger PAS flippé** (pas de GO/NO-GO gravé) ; 17.2 reste gated.
- **ADR-0016 : status `proposed`** — le cadre + les mesures sont là, mais le **verdict final n'est pas figé** (accepted/rejected).
- Banc d'essai NPU utilisable dans Doku : onglet « NPU (essai) » → sidecar `py spike/npu-17.1/sidecar/npu_server.py` (défaut 1.5b ; `NPU_MODEL=~/npu-models/qwen7b-qnn` pour le 7B). Prérequis : `py -m pip install onnxruntime onnxruntime-qnn onnxruntime-genai`.

## Next concrete step
**Trancher le GO/NO-GO NPU** (décision produit en suspens). Deux options sur la table :
1. L'utilisateur **teste le 7B dans Doku** (qualité OK mais lent/fragile RAM) pour sentir le compromis → puis décide.
2. **Acter NO-GO** (reco) : sur 16 Go le NPU n'a pas de sweet spot. Graver **ADR-0016 → rejected** (avec les mesures), fermer 17.2, flipper 17.1 au ledger avec le verdict, et **basculer le vrai levier utile : câbler + mesurer `qwen2.5:3b-instruct-q4_0` en défaut CPU** (plus intelligent que le 1.5b, fiable — le préalable qu'on avait sauté). Voir mémoire [[upgrade-modele-copilote]].

Après ça, clore le sprint 15 (rétro).
