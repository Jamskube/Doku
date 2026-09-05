# Plan — Signer l'installateur et livrer les mises à jour

## Pourquoi

Sans signature de code, SmartScreen bloque l'installateur NSIS chez toute personne qui n'est pas le développeur. Sans updater, chaque version se réinstalle à la main. Les deux demandent des **secrets qui ne sont pas dans le dépôt** ; ce plan dit exactement quoi créer et où le poser. Rien ici n'est activé tant que les secrets n'existent pas : `createUpdaterArtifacts` fait échouer un build sans clé.

## Étape 1 — Signature de code (Windows)

1. Obtenir un certificat de signature de code (Azure Trusted Signing est le moins cher pour un développeur seul ; sinon un certificat OV/EV chez un émetteur).
2. Dans `src-tauri/tauri.conf.json`, bloc `bundle.windows` :
   - Azure Trusted Signing : `"signCommand": "trusted-signing-cli -e <endpoint> -a <account> -c <profile> %1"` (l'outil lit `AZURE_*` depuis l'environnement).
   - Certificat classique : `"certificateThumbprint": "<empreinte>"`, `"digestAlgorithm": "sha256"`, `"timestampUrl": "http://timestamp.digicert.com"`.
3. Les trois workflows `build-*.yml` reçoivent les secrets (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, ou le `.pfx` en base64 + mot de passe) via `secrets.*` — jamais dans le YAML.
4. Vérification : `signtool verify /pa /v Doku_*.exe` doit rendre « Successfully verified ».

## Étape 2 — Updater Tauri

1. Générer la paire de clés une seule fois : `npm run tauri signer generate -- -w ~/.tauri/doku.key`. La clé privée ne quitte pas la machine du mainteneur ; la clé publique va dans le dépôt.
2. Ajouter `tauri-plugin-updater = "2"` (Cargo) et `@tauri-apps/plugin-updater` (npm) ; `"updater:default"` dans `src-tauri/capabilities/default.json`.
3. `tauri.conf.json` :
   ```json
   "bundle": { "createUpdaterArtifacts": true },
   "plugins": { "updater": { "pubkey": "<clé publique>", "endpoints": ["https://github.com/Jamskube/Doku/releases/latest/download/latest.json"] } }
   ```
4. Les workflows `build-*.yml` reçoivent `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, et publient `latest.json` + les artefacts `.nsis.zip`/`.sig` dans la release GitHub (action `tauri-apps/tauri-action` ou étape `gh release upload`).
5. Côté app : au démarrage, `check()` du plugin ; si une version existe, une bannière « Doku 3.4 est disponible — Installer » (jamais silencieux, jamais forcé) ; `downloadAndInstall()` puis `relaunch()` sur clic.
6. Premier tag : `git tag v3.4.0 && git push --tags` déclenche les builds ; le dépôt n'a **aucun tag** à ce jour.

## Critères d'acceptation

- Un installateur téléchargé sur une machine vierge s'ouvre sans avertissement SmartScreen.
- Une version N installée détecte N+1 publiée et l'installe en un clic, signature vérifiée.
- Aucun secret dans le dépôt, aucun build qui réussit sans signature.

## Hors périmètre

- Mise à jour silencieuse en arrière-plan.
- Canal bêta.
