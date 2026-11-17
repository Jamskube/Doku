---
title: Signature manuscrite posee sur un PDF
author: Kubo
date: 2026-11-17
branch: main
cost: { minutes: 14, tokens: 227334 }
touches:
  - docs/agent-knowledge/index.md
  - docs/journal/_next-session.md
  - src-tauri/src/openai.rs
  - src/App.svelte
  - src/README.md
  - src/assets/icons.svg
  - src/components/CopilotPanel.svelte
  - src/components/DocxView.svelte
  - src/components/PdfView.svelte
  - src/components/TitleBar.svelte
---

## Decided
Signature manuscrite PDF = un trace ink ordinaire du carnet (src/lib/pdf-signature-stamp.ts) : deplacement, gomme, annulation, impression et gravure dans la copie exportee viennent du carnet, sans nouveau type de dessin ni changement de manifeste.
La signature est stockee normalisee dans sa boite englobante (0..1) avec son rapport largeur/hauteur ; la pose recoit le rapport de la PAGE car les fractions de page ne sont pas isotropes.
Stockage : appData/signature.json (localStorage hors Tauri), relu a chaque activation de l outil.

## Tried and ruled out
Supprimer le fichier pour oublier la signature : fs:allow-remove ne couvre pas la racine de appData. On ecrit une chaine vide plutot que d elargir la capacite.
Icone trash-2 : absente du jeu connu du sprite, utiliser trash.

## Watch out
Le pave SignaturePad est rendu HORS du div pdf-shell : dedans, Echap fermerait le pave ET eplucherait une couche du lecteur (ownsGlobalKeys teste le focus dans le shell).
Le harnais .agent/visual/pdf-annotations/harness.html monte le vrai PdfView dans le navigateur : c est le moyen de verifier un outil PDF sans compiler Tauri.
