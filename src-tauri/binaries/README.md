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
- Site Ollama : https://ollama.com/download/windows (build ARM64), ou
- Releases GitHub : https://github.com/ollama/ollama/releases (asset Windows ARM64), ou
- `winget install Ollama.Ollama` puis copier l'`ollama.exe` installé.

Récupère `ollama.exe`, **copie-le** ici et **renomme-le** `ollama-aarch64-pc-windows-msvc.exe`.

> Sans ce fichier, `npm run tauri dev` échoue au bundling (externalBin introuvable).
> Le code du sidecar (spawn/port/kill) et le client TS sont là ; seule la **validation
> native** du spike 13.1 exige ce binaire.
