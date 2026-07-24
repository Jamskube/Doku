# Spike 17.1 — Backend d'inférence NPU (Foundry Local) : trancher GO/NO-GO par la mesure

## Purpose
Décider, **par la donnée sur cette Surface Pro 11 (Snapdragon X Plus)**, si un backend NPU via **Microsoft Foundry Local** (ONNX Runtime + execution provider QNN) vaut la complexité, face à la stack CPU actuelle (Ollama, `qwen2.5:3b-instruct-q4_0`). Douleur ciblée : **~45 s de prefill** avant le 1er token sur longs docs. Sortie du spike : les mesures ci-dessous **remplissent `docs/adr/0016-backend-inference-npu-foundry-local.md`** et figent le verdict.

> ⚠️ **Le NPU n'est pas un gain gratuit.** Il est rapide au **prefill** mais **plus lent au decode** que le CPU q4_0, et Foundry Local **ne sait pas** faire prefill-NPU/decode-CPU (tout le modèle sur un seul EP). Le spike doit donc mesurer le **bout-à-bout d'une vraie réponse**, pas juste le 1er token — sinon on décide sur un régime qui n'existe pas en usage.

## Ce que tu exécutes (commandes exactes)

### 0. Prérequis — machine sur SECTEUR, mode « performances maximales »
Le Surface Pro 11 est **fanless** : sur batterie, NPU et CPU sous-cadencent ; en enchaînant les runs, le second throttle. Branche le secteur, ferme les apps lourdes.

### 1. Installer Foundry Local + provisionner (ceci nécessite le réseau — c'est attendu, une fois)
```powershell
winget install Microsoft.FoundryLocal
foundry service start
foundry service status          # note le PORT affiché → à mettre dans bench.config.json
# Modèle NPU contender (décision, comparaison B) :
foundry model run qwen2.5-7b-instruct-qnn-npu
# Vérifie qu'il a bien un build NPU (suffixe -qnn-npu) et pas un repli CPU :
foundry model list
```
> Si `qwen2.5-7b-instruct-qnn-npu` est absent du catalogue local (bug connu #783/#259), essaie `phi-4-mini-reasoning-qnn-npu` — mais note qu'il est **plus faible en français** (pèsera au gate qualité H5).

### 2. Baseline CPU (Ollama, déjà en place)
```powershell
ollama pull qwen2.5:3b-instruct-q4_0      # ta meilleure stack CPU (mémoire upgrade-modele-copilote)
ollama serve                               # port 11434 par défaut
```

### 3. Lancer le banc (comparaison B = décision)
```powershell
cd spike/npu-17.1
copy bench.config.example.json bench.config.json
# édite bench.config.json : remplace PORT par le port Foundry (étape 1)
node bench.mjs bench.config.json
```
Le banc fait : **warm-up jeté** par backend (sort le load + compile QNN du TTFT → reporté comme `coldStartTtftMs`), puis `runs` mesures **interleavées A/B** par taille d'entrée, avec **cooldown** entre chaque. Il écrit `results/bench-<horodatage>.json`.

### 4. Comparaison A (informative, isolation matérielle) — optionnelle
Même modèle des deux côtés pour isoler le speedup NPU pur du prefill. **Attention** : les quantifications diffèrent (Ollama Q4 vs QNN INT8) → **A ne prouve pas un « speedup hardware pur »**, elle est indicative. Crée `bench.config.A.json` avec `qwen2.5:7b` (Ollama) vs `qwen2.5-7b-instruct-qnn-npu` (Foundry) et relance.

### 5. Gate qualité FR EN AVEUGLE (H5 — un modèle plus rapide mais moins bon = NO-GO)
Le contender NPU est un **modèle différent** du tien. Pose les 3 prompts de `longdoc.mjs` (`QUALITY_PROMPTS`) aux deux backends, mélange les réponses sans étiquette, et juge **fidélité + français**. **GO exige qualité ≥ `qwen2.5:3b-instruct-q4_0`.**

### 6. RAM crête (M5)
Pendant une vraie tâche, relève le **working set crête** (Gestionnaire des tâches → Détails) du process Foundry + modèle. 16 Go partagés, pas de VRAM dédiée : un 7B QNN + l'app + WebView2 peut saturer → swap → latence catastrophique sans rapport avec le NPU.

### 7. Preuve 0-réseau (H4 — gate NFR DUR, capture PLEIN CYCLE)
`Get-NetTCPConnection` seul est un snapshot insuffisant. Capture tout le cycle avec **pktmon** (natif Windows, rien à installer) :
```powershell
pktmon start --capture --pkt-size 0 --file-name npu-cycle.etl
# pendant la capture : provisioning (si pas déjà fait), 1er load du modèle, une inférence complète
pktmon stop
pktmon format npu-cycle.etl --output npu-cycle.txt
# cherche tout egress NON-loopback (hors 127.0.0.1 / ::1) :
Select-String -Path npu-cycle.txt -Pattern '(?<!127\.0\.0\.)(?<!::)\b\d+\.\d+\.\d+\.\d+' | Select-Object -First 40
```
**Test décisif complémentaire** : coupe l'adaptateur réseau (`Disable-NetAdapter`), **redémarre Foundry à froid** et refais une inférence — si le modèle ne charge pas ou l'EP QNN valide un manifeste en ligne, l'air-gap est **cassé** (montre la régression #275). Reporte : provisioning-online-une-fois puis air-gap = OK, ou air-gap impossible = NO-GO.

## Grille de décision (seuils PRÉ-ENREGISTRÉS — M6, à ne pas bouger après avoir vu les chiffres)
GO **seulement si TOUS** :
1. **Prefill** : TTFT NPU à 4000 tok (≈14400c) **< 5 s** ET **au moins 3× plus rapide** que le CPU baseline.
2. **Bilan bout-à-bout** : pour une réponse de 400 tokens, e2e NPU **strictement < e2e CPU** (le decode plus lent ne doit pas manger le gain prefill), ET **`crossoverOutputTokens` > 800** (marge au-delà des réponses usuelles).
3. **0-réseau** : capture pktmon plein cycle **sans egress non-loopback** ET cold-load air-gap fonctionnel.
4. **Qualité** : réponses FR du contender **≥ baseline** en aveugle.
5. **RAM** : working set crête **< 12 Go** (marge sous 16).
6. **Licence** : DLLs QNN/Qualcomm réellement chargées **redistribuables** dans un bundle.

**Un seul échec → NO-GO** → repli documenté sur le levier CPU (`qwen2.5:3b-instruct-q4_0`), Epic 17 re-noté « piste, préalable CPU d'abord ». **Un NO-GO chiffré est une livraison valide du spike.**

## Files
| Fichier | Rôle |
|---|---|
| `longdoc.mjs` | Corpus FR déterministe (charge de prefill réglable) + tâche réelle (résumé) + prompts qualité |
| `bench.mjs` | Banc : TTFT + decode tok/s + bout-à-bout + vrais compteurs tokens + cold-start + croisement L* |
| `bench.config.example.json` | Gabarit de config (copier → `bench.config.json`, remplir le port Foundry) |
| `results/` | Résultats JSON vendorés (jeu de régression + preuve de la décision) |

## Dependencies
- **Internal** : aucune (autonome, ne dépend pas de l'app — comme `spike/rag-15.1/`).
- **External** : Node ≥ 18 (fetch global), Foundry Local (winget), Ollama (sidecar du repo), pktmon (natif Windows).

## Non couvert (dit honnêtement)
- Pas de split prefill-NPU/decode-CPU (Foundry ne l'expose pas) — mesuré comme limite, pas contourné.
- Comparaison A biaisée par les quantifications différentes (Q4 vs INT8) → informative seulement.
- Estimation de longueur de doc approximative : les **vrais** compteurs de tokens sont relus de l'API et doivent concorder à quelques % près avant de croire une comparaison.
