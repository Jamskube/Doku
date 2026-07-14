# Binaires externes (sidecar)

Ce dossier reçoit les **binaires externes** embarqués par Tauri (`bundle.externalBin`).
Ils ne sont **pas commités** (voir `.gitignore` : `src-tauri/binaries/*.exe`) car volumineux.

## Ollama (spike 13.1 / cap v2)

Doku lance `ollama.exe` en sidecar (ADR-0006 / ADR-0012). Le fichier doit être nommé
avec le **suffixe de triplet cible**, sinon `tauri dev` / `tauri build` ne le trouvent pas :

```
src-tauri/binaries/ollama-aarch64-pc-windows-msvc.exe
```

(Le triplet exact = `rustc -Vv` → ligne `host:`. Sur Surface Pro 11 = `aarch64-pc-windows-msvc`.)

### Où récupérer un build ARM64 Windows
Asset **`ollama-windows-arm64.zip`** des releases GitHub (léger, ~16 Mo, CPU-only) :
https://github.com/ollama/ollama/releases (testé : v0.32.0).

### ⚠️ Ce n'est PAS un exe isolé
Le zip contient `ollama.exe` **ET** un dossier `lib/ollama/` de DLLs d'inférence CPU
(`ggml-cpu.dll`, `libllama.dll`, `llama-server.exe`…). `ollama.exe` charge ces DLLs
**relativement à son propre dossier** — donc `lib/` doit rester **à côté** de l'exe.

Procédure : dézippe **tout** le contenu ici (`src-tauri/binaries/`), puis renomme
`ollama.exe` → `ollama-aarch64-pc-windows-msvc.exe`. Le renommage est sans risque
(Ollama trouve `lib/` par le dossier de l'exe, pas par son nom). Résultat attendu :

```
src-tauri/binaries/
  ollama-aarch64-pc-windows-msvc.exe
  lib/ollama/  (DLLs)
```

Sanity-check : `./ollama-aarch64-pc-windows-msvc.exe --version` doit afficher la version.

> Sans ce fichier, `npm run tauri dev` échoue au bundling (externalBin introuvable).
> Le code du sidecar (spawn/port/kill) + le client TS sont là ; seule la **validation
> native** du spike 13.1 exige ces binaires.
>
> **`lib/ollama` au runtime (13.2 réglé).** Ollama lance `llama-server.exe` (+ DLLs ggml)
> sous `<OLLAMA_LIBRARY_PATH>/lib/ollama`. `sidecar.rs` fixe `OLLAMA_LIBRARY_PATH` selon le
> profil : **dev** → `src-tauri/binaries` (via `CARGO_MANIFEST_DIR`, la lib y est extraite,
> donc **plus besoin de hand-copier dans `target/debug`**) ; **release** → `resource_dir()`,
> où `bundle.resources` (`"binaries/lib/ollama/": "lib/ollama/"`) copie la lib à côté de l'exe
> empaqueté. À valider au prochain `tauri build` (packaging release non exercé en dev).
