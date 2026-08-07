# Doku Material Lab

## Purpose

Outil local pour ajuster visuellement les couches du matériau utilisé par la sidebar et les headers de Doku, puis exporter une configuration JSON reproductible.

## Files

| File | Purpose |
|---|---|
| `index.html` | Prévisualisation Doku, réglages du dégradé et export JSON |

## Usage

Depuis la racine du projet :

    npm run material-lab

La page s'ouvre sur `http://127.0.0.1:1421/spike/material-lab/`. Les réglages sont conservés dans le stockage local du navigateur. La réinitialisation restaure le matériau actuellement livré dans Doku. Utiliser **Copier le JSON** ou **Télécharger JSON**, puis transmettre le résultat pour l'intégration dans `src/app.css`.

## Dependencies

- Internal: aucune
- External: navigateur moderne uniquement
