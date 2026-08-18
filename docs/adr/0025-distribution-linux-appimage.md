# 0025. Distribution Linux : AppImage, et l'Ollama de la distribution

**Date** : 2026-08-18 · **Status** : accepted · **Deciders** : nicos · **Tags** : distribution, linux, appimage, ollama, sidecar, ci

## Contexte

Un collègue sous **Arch Linux** doit pouvoir utiliser Doku. Jusqu'ici la distribution est exclusivement Windows : deux installateurs NSIS (ARM64 et x64), chacun embarquant un sidecar Ollama CPU natif.

L'hôte Rust, lui, était **déjà portable** — travail fait en amont et jamais exercé : les dépendances `windows` et `window-vibrancy` sont sous `[target.'cfg(windows)'.dependencies]`, `secrets.rs` a ses branches `#[cfg(not(windows))]`, le Job Object de `sidecar.rs` est isolé, et `set_system_backdrop` rend `false` hors Windows. Rien n'empêchait la compilation ; tout empêchait l'empaquetage.

Trois questions se posaient : quel **format**, quel **sidecar**, et depuis **quelle machine**.

## Décision

**Format : AppImage.** Tauri produit `deb`, `rpm` et `appimage` sous Linux. Arch n'utilise ni deb ni rpm, et un PKGBUILD n'a de sens que pour une distribution large — pas pour donner une copie à un collègue. L'AppImage est un fichier unique, exécutable sans installation ni droits administrateur, indépendant de la distribution.

**Sidecar : celui du système, pas le nôtre.** Hors Windows, `start_ollama` lance `ollama` depuis le `PATH` (`app.shell().command("ollama")`) au lieu du binaire empaqueté. Le reste du cycle de vie est inchangé : port éphémère, `OLLAMA_MODELS` isolé dans le dossier de données de l'application, `OLLAMA_NO_CLOUD`, `OLLAMA_REMOTES`, `OLLAMA_ORIGINS`.

La raison est décisive : l'archive Linux d'Ollama 0.32.0 pèse **1,44 Go**, alors qu'un utilisateur d'Arch écrit `sudo pacman -S ollama`. Le sidecar Windows existe parce que Windows n'a pas de gestionnaire de paquets sur lequel compter ; transposer ce choix à Linux reviendrait à dupliquer, moins bien et sans mises à jour, ce que la distribution fait déjà. `OLLAMA_LIBRARY_PATH` n'est plus posé hors Windows : l'Ollama du système connaît ses bibliothèques.

**Absence = message, jamais silence** (règle Epic 19). Si `ollama` n'est pas sur le `PATH`, l'échec de `spawn` n'est pas rendu tel quel (« No such file or directory » ne dit ni quoi ni comment) : `spawn_error` rend, hors Windows, une phrase qui nomme le manque et la commande qui le comble.

**Configuration : `tauri.linux.conf.json`.** Les configurations par plateforme de Tauri 2 suivent **JSON Merge Patch (RFC 7396)**, où une clé à `null` est *supprimée*. `externalBin` et l'entrée `binaries/lib/ollama/` de `resources` sont donc retirées pour Linux **sans toucher au fichier de base** — les installateurs Windows qui fonctionnent ne sont pas remis en jeu.

**Construction : GitHub Actions.** Impossible depuis la machine de développement : Tauri se lie sous Linux à WebKitGTK, GTK3 et libsoup, qui ne se cross-compilent pas depuis Windows ; et WSL sur une Surface ARM64 produirait un binaire ARM, pas le x86_64 attendu. `build-linux-x64.yml` calque `build-windows-x64.yml`, sans l'étape de préparation du sidecar.

## Conséquences

**Positif** : un fichier unique à transmettre ; aucun sidecar de 1,4 Go à empaqueter, télécharger ni maintenir ; Ollama mis à jour par la distribution ; le fichier de configuration de base reste celui, éprouvé, des builds Windows ; la portabilité de l'hôte Rust, écrite mais jamais exercée, devient enfin vérifiée par la CI.

**Négatif, et il faut le dire clairement :**

- **Le copilote cloud ne fonctionne pas sous Linux.** `write_secret` hors Windows rend « Le stockage protégé […] est actuellement disponible sous Windows » : ni OpenAI ni MiniMax. Seul Ollama local est disponible. Y remédier demande un dorsal Secret Service (GNOME Keyring / KWallet) — la caisse `keyring` couvre les trois systèmes et simplifierait au passage le code Windows. **C'est la suite naturelle de cette ADR.**
- **Ollama devient un prérequis** sous Linux, là où Windows n'en a aucun. Assumé : c'est la convention de la plateforme.
- **Pas de matériau Mica** ; le chrome CSS opaque prend le relais, comme prévu.
- **Aucune vérification sur machine réelle.** La CI prouve que ça compile et que l'AppImage est bien formée, pas que l'application se lance. WebKitGTK sur Arch est souvent en avance sur ce qu'attend Tauri : le premier essai réel est celui du collègue, et un ou deux allers-retours sont à prévoir.
- **Pas de mise à jour automatique** : une AppImage se remplace à la main.
