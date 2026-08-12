# Binaires externes

Ce dossier reçoit les sidecars Ollama embarqués par Tauri. Les exécutables, DLL et archives
sont ignorés par Git ; seuls les scripts de préparation et leurs empreintes sont commités.

## Architectures Windows

| Cible | Triplet Tauri | Archive officielle Ollama 0.32.0 |
|---|---|---|
| ARM64 | `aarch64-pc-windows-msvc` | `ollama-windows-arm64.zip` |
| x64 Intel/AMD | `x86_64-pc-windows-msvc` | `ollama-windows-amd64.zip` |

Tauri sélectionne automatiquement `ollama-<triplet>.exe` pour la cible demandée. Les DLL
vivent toutes sous `lib/ollama/` et ne peuvent pas mélanger deux architectures : le script
`scripts/prepare-ollama-sidecar.mjs` remplace donc ce dossier avant chaque build.

## Commandes

```powershell
npm run prepare:ollama:arm64
npm run prepare:ollama:x64
npm run build:installer:arm64
npm run build:installer:x64
```

Les téléchargements officiels sont épinglés à Ollama 0.32.0 et vérifiés par SHA-256 avant
extraction. Pour x64, le script extrait uniquement le payload CPU officiel : les bibliothèques
CUDA/ROCm/MLX de l'archive de 1,5 Go ne sont pas embarquées dans Doku. L'installateur reste
ainsi compact et fonctionne sur les PC Intel/AMD sans GPU compatible.

La CI `.github/workflows/build-windows-x64.yml` construit l'installateur x64 sur un runner
Windows x64, vérifie les architectures PE, effectue une installation silencieuse isolée,
démarre le sidecar installé et publie l'installateur avec son SHA-256.

La licence MIT d'Ollama est distribuée sous `resources/licenses/Ollama-LICENSE.txt`.
