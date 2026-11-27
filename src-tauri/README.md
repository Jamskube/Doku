# src-tauri

## Purpose
Hôte Tauri 2 de Doku. **Rust minimal, zéro logique métier** ([ADR-0004](../docs/adr/0004-io-fichiers-plugins-officiels.md)) : les I/O passent par les plugins officiels, et le Rust ne sert que là où la webview ne peut rien — coffre de secrets, cycle de vie du moteur IA local, streaming des fournisseurs cloud, matériau Mica.

## src/
| File | Purpose |
|---|---|
| `main.rs` | Assemblage Tauri : plugins, commandes, instance unique, fichier passé en argument, matériau Mica (Windows) |
| `secrets.rs` | Coffre de secrets, une API pour deux faces ([ADR-0026](../docs/adr/0026-coffre-de-secrets-multiplateforme.md)) : Credential Manager en natif sous Windows, Secret Service via `keyring` ailleurs |
| `sidecar.rs` | Cycle de vie du routeur `llama-server` ([ADR-0032](../docs/adr/0032-moteur-local-llamacpp-lfm3.md)) : port éphémère, preset régénéré, `--offline`, CORS limité à la webview. Job Object sous Windows pour un kill d'arbre garanti (enfants du routeur compris) |
| `models.rs` | Catalogue fermé des modèles locaux (URL épinglée, SHA-256, taille) : téléchargement vérifié et annulable, suppression, preset INI du routeur (le module audio `mmproj` s'attache à la section de son modèle, ADR-0033) |
| `openai.rs` | Connexion du compte OpenAI par code d'appareil et streaming Codex — jamais de clé API, jamais de jeton rendu à la webview |
| `compat.rs` | Fournisseurs compatibles OpenAI ([ADR-0018](../docs/adr/0018-fournisseur-cloud-compatible-openai.md)) : registre **en dur** (base URL non configurable), validation de clé avant stockage, streaming SSE |
| `sse.rs` | Découpage d'un flux Server-Sent Events — partagé par `openai.rs` et `compat.rs` |

## Autres dossiers
| Folder | Purpose |
|---|---|
| `capabilities/` | ACL Tauri : ce que la webview a le droit d'appeler |
| `binaries/` | Moteur llama.cpp préparé par `npm run prepare:llama:*` — **jamais versionné** |
| `installer/` | Template NSIS forké et ses visuels (re-diff obligatoire à chaque montée du CLI Tauri) |
| `resources/` | Ressources empaquetées, dont les licences des dépendances |
| `icons/` | Icônes de l'application, dérivées d'`icon-source.svg` |
| `gen/` | Schémas générés par Tauri |

## Configuration
| File | Purpose |
|---|---|
| `tauri.conf.json` | Configuration de base : fenêtre, bundle, associations de fichiers, ressource `llama/` du moteur |
| `tauri.linux.conf.json` | Surcouche Linux (RFC 7396 — une clé à `null` la **supprime**) : AppImage et .deb |
| `Cargo.toml` | Dépendances ; celles de Windows et celles hors Windows sont séparées par `[target.'cfg(...)']` |

## Dependencies
- Internal: `src/` (la webview qu'il héberge), `scripts/prepare-llama-sidecar.mjs`
- External: Tauri 2 et ses plugins officiels (fs, dialog, shell, opener, single-instance), `reqwest`, `tokio`, `sha2`, `keyring` (hors Windows), `windows` et `window-vibrancy` (Windows)
