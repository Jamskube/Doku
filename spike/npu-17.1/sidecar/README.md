# Sidecar NPU — banc d'essai (17.1)

Endpoint **OpenAI-compatible streamé** servi par `onnxruntime-genai` + EP **QNN** sur
le Hexagon (Snapdragon X Plus). But : basculer le copilote de Doku sur NPU pour
**comparer l'expérience** à Ollama CPU. **Pas la forme livrable** (ce serait des
bindings Rust dans le sidecar Tauri, seulement si l'essai convainc).

## Ce qui a débloqué le NPU (là où Foundry Local échoue)
Foundry 0.10.2 ne provisionne pas l'EP QNN (bug de découverte). La voie qui marche :
ORT-genai **en direct** + `onnxruntime-qnn` (DLLs Qualcomm + skels Hexagon v73), en
enregistrant l'EP en plugin et en pointant `ADSP_LIBRARY_PATH` sur les libs.

## Prérequis (une fois)
```
py -m pip install -r requirements.txt
```

## Lancer
```
py spike/npu-17.1/sidecar/npu_server.py
```
Attends `[npu] prêt sur http://127.0.0.1:8017/v1`. Laisse cette fenêtre ouverte.

Variables d'env optionnelles : `NPU_PORT` (défaut 8017), `NPU_MODEL` (chemin du modèle ;
défaut = le qwen2.5-1.5b-instruct-qnn-npu du cache Foundry).

## Modèle
Réutilise `qwen2.5-1.5b-instruct-qnn-npu` (cache Foundry) — **même modèle** que l'app en
CPU (`qwen2.5:1.5b-instruct-q4_0`), donc la comparaison NPU/CPU est à qualité égale.
