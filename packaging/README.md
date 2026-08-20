# packaging

## Purpose
Recettes d'empaquetage qui ne sont pas produites telles quelles par le constructeur de Tauri — aujourd'hui, le paquet Arch.

## Files
| File | Purpose |
|---|---|
| `arch/PKGBUILD` | Paquet Arch `doku` (`.pkg.tar.zst`) — empaquette le binaire compilé dans un conteneur Arch |

## Pourquoi un paquet natif, et pas l'AppImage
L'AppImage produite par Tauri passe par `linuxdeploy-plugin-gtk`, qui **embarque la pile GTK et Mesa du runner Ubuntu**. Sur une distribution dont les pilotes graphiques sont rangés autrement — Arch en particulier — ce `libEGL` empaqueté n'arrive pas à énumérer ceux de l'hôte, et GDK abandonne avant même d'ouvrir une fenêtre :

```
Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
```

Aucun réglage `WEBKIT_*` n'y change quoi que ce soit : la panne est **sous** WebKit, dans l'initialisation de GDK. Le raisonnement déjà retenu pour Ollama dans [ADR-0025](../docs/adr/0025-distribution-linux-appimage.md) — ne pas transporter ce que la distribution fournit mieux — vaut donc pour **toute la pile système**, pas seulement pour le sidecar.

L'AppImage reste publiée : elle est commode là où elle fonctionne, sur les dérivées d'Ubuntu.

## Le paquet est construit DANS Arch
Le workflow `Build Arch x64` tourne dans un conteneur `archlinux:base-devel` : `npm ci`, les tests, `tauri build --no-bundle`, puis `makepkg`. Le binaire est **compilé et lié sur place**, contre le `webkit2gtk-4.1` d'Arch. Rien n'est transporté, rien n'est converti depuis un autre format de paquet.

La CI **installe ensuite le paquet pour de vrai** (`pacman -U`) et vérifie que chaque bibliothèque du binaire se résout (`ldd`, échec au moindre « not found »). C'est exactement le contrôle qui manquait à l'AppImage : la famille de panne qui a cassé chez l'utilisateur échoue désormais en CI.

## Utilisation
```bash
# Récupérer l'artefact du workflow « Build Arch x64 »
gh run download <run-id> -n Doku-main-arch-x64

# Installer — c'est un vrai paquet Arch
sudo pacman -U doku-3.2.0-1-x86_64.pkg.tar.zst

doku                  # ou depuis le menu des applications
sudo pacman -R doku   # désinstallation propre
```

Ollama reste facultatif et vient d'Arch : `sudo pacman -S ollama`.

## Dependencies
- Internal: `.github/workflows/build-arch-x64.yml` (compile et empaquette), `src-tauri/` (binaire, icônes, licences)
- External: `pacman`, `makepkg`, conteneur `archlinux:base-devel`
