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

- ~~**Le copilote cloud ne fonctionne pas sous Linux.**~~ **LEVÉ le jour même par [ADR-0026](./0026-coffre-de-secrets-multiplateforme.md)** : `write_secret` s'appuie désormais sur le Secret Service de la session via `keyring`. OpenAI et MiniMax sont disponibles sous Linux.
- **Ollama devient un prérequis** sous Linux, là où Windows n'en a aucun. Assumé : c'est la convention de la plateforme.
- **Pas de matériau Mica** ; le chrome CSS opaque prend le relais, comme prévu.
- ~~**Aucune vérification sur machine réelle.**~~ **Vérifié le jour même, et l'AppImage a ÉCHOUÉ sur Arch** — voir l'amendement ci-dessous.
- **Pas de mise à jour automatique** : une AppImage se remplace à la main.

---

## Amendement du 2026-08-18 — le .deb rejoint l'AppImage

**Ce qui s'est passé.** Première exécution réelle sur Arch : `WebKitWebProcess` abandonne (SIGABRT), console à l'appui :

```
Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
```

Aucun des réglages recommandés par Tauri n'y change rien — ni `WEBKIT_DISABLE_DMABUF_RENDERER`, ni `WEBKIT_DISABLE_COMPOSITING_MODE`, ni `__NV_DISABLE_EXPLICIT_SYNC`, ni un repli sur X11. C'est le fait décisif : ce message vient de **GDK**, pas de WebKit, et la panne se situe donc **sous** tout ce que ces variables pilotent.

**La cause.** Tauri empaquette l'AppImage avec `linuxdeploy-plugin-gtk`, qui embarque la pile GTK **et Mesa du runner Ubuntu**. Ce `libEGL` d'Ubuntu n'arrive pas à énumérer les pilotes d'Arch, et GDK abandonne avant d'ouvrir une fenêtre. Le format lui-même porte le défaut : une AppImage transporte ses bibliothèques, et une pile graphique ne se transporte pas d'une distribution à l'autre.

**La décision.** Le workflow produit désormais **aussi un `.deb`**, qui ne transporte aucune bibliothèque système mais les **déclare**, et un `PKGBUILD` (`packaging/arch/`) le convertit en paquet Arch dont les dépendances sont servies par pacman. La CI **vérifie** que ce `.deb` n'embarque ni `libEGL`, ni `libgbm`, ni `libGL` — sans quoi il perdrait sa raison d'être.

L'AppImage reste publiée : elle est commode là où elle fonctionne, notamment sur les dérivées d'Ubuntu.

**Ce que ça confirme.** Le raisonnement tenu pour Ollama — ne pas transporter ce que la distribution fournit mieux — valait pour toute la pile système, pas seulement pour le sidecar. Il n'a pas été poussé assez loin du premier coup ; c'est l'exécution réelle qui l'a montré, et rien d'autre n'aurait pu.
