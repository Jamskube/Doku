# Binaires externes

Ce dossier reçoit le moteur IA local llama.cpp (ADR-0032), livré par Tauri comme ressource
`llama/`. Les exécutables, bibliothèques et archives sont ignorés par Git ; seul le script de
préparation (et ses empreintes) est commité.

## Cibles

| Cible | Script | Archive officielle llama.cpp b12810 |
|---|---|---|
| Windows ARM64 | `npm run prepare:llama:arm64` | `llama-b12810-bin-win-cpu-arm64.zip` |
| Windows x64 | `npm run prepare:llama:x64` | `llama-b12810-bin-win-cpu-x64.zip` |
| Linux x64 | `npm run prepare:llama:linux-x64` | `llama-b12810-bin-ubuntu-x64.tar.gz` |

`scripts/prepare-llama-sidecar.mjs` vérifie le SHA-256 de l'archive (cache sous
`.cache/llama-b12810/`), puis **remplace** `llama/` par `llama-server`, ses bibliothèques
partagées (sans celles des autres outils de l'archive) et ses licences. Les DLL doivent rester à
côté de l'exécutable : le chargeur Windows les cherche là. Une seule architecture à la fois —
relancer le script avant de construire pour une autre cible.

## Commandes

```powershell
npm run prepare:llama:arm64
npm run build:installer:arm64
npm run build:installer:x64   # prépare x64 lui-même
```

Les licences distribuées vivent sous `resources/licenses/` (`llama.cpp-LICENSE.txt`,
`LLVM-OpenMP-LICENSE.txt`).
