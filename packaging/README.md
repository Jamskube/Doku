# packaging

## Purpose
Recettes d'empaquetage qui ne sont pas produites par la CI elle-même — aujourd'hui, le paquet Arch.

## Files
| File | Purpose |
|---|---|
| `arch/PKGBUILD` | Paquet Arch (`doku-bin`) construit à partir du `.deb` de la CI, avec les dépendances servies par pacman |

## Pourquoi le .deb et pas l'AppImage
L'AppImage produite par Tauri passe par `linuxdeploy-plugin-gtk`, qui **embarque la pile GTK et Mesa du runner Ubuntu**. Sur une distribution dont les pilotes graphiques sont rangés autrement — Arch en particulier — ce `libEGL` empaqueté n'arrive pas à énumérer ceux de l'hôte, et GDK abandonne avant même d'ouvrir une fenêtre :

```
Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
```

Aucun réglage `WEBKIT_*` n'y change quoi que ce soit : la panne est **sous** WebKit, dans l'initialisation de GDK.

Le `.deb` ne transporte aucune bibliothèque système, il les **déclare**. Le PKGBUILD reprend ces dépendances en `depends`, et c'est pacman qui les sert — à jour, et cohérentes avec le reste de la machine. C'est exactement le raisonnement déjà retenu pour Ollama dans [ADR-0025](../docs/adr/0025-distribution-linux-appimage.md) : ne pas transporter ce que la distribution fournit mieux.

L'AppImage reste publiée : elle est pratique là où elle fonctionne, notamment sur les dérivées d'Ubuntu.

## Utilisation
```bash
# 1. Récupérer l'artefact du workflow « Build Linux x64 »
gh run download <run-id> -n Doku-main-linux-x64

# 2. Poser le .deb à côté du PKGBUILD, puis
cd packaging/arch && makepkg -si
```

## Dependencies
- Internal: `.github/workflows/build-linux-x64.yml` (produit le `.deb`)
- External: `pacman`, `makepkg`, `bsdtar`
