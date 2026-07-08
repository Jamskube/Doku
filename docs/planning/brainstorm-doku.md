# Brainstorm : Doku — lecteur/éditeur de documents léger (Markdown, HTML, puis PDF)

**Date** : 2026-07-08
**Problème (how-might-we)** : Comment créer un outil desktop Windows léger et simple pour ouvrir, lire et éditer tous mes documents (Markdown d'abord, HTML, PDF ensuite) afin de ne plus jongler entre plusieurs apps lourdes — outil perso, utilisateur unique.
**Technique** : Free flow · **Idées générées** : 19

**Contraintes découvertes pendant le cadrage** :
- Machine cible : **Surface Pro 11, Windows ARM64** (Snapdragon X Elite, NPU disponible) → la stack devra compiler/tourner nativement en ARM64
- Un **repo local existant** contient déjà un mode lecture/édition Markdown → référence pour le design et l'implémentation (chemin à fournir)
- Design : thème clair **crème**, design fait avec Claude design en s'appuyant sur le repo existant
- Installateur accepté si ça permet une app rapide et puissante (portable zéro-install non prioritaire)

---

## Top concepts (priorisés)

### 1. Cœur visionneuse multi-format à onglets — **DO FIRST**
Ouverture instantanée (<1 s) par double-clic, app par défaut pour `.md`, onglets multi-documents avec formats mélangés. Architecture noyau + un renderer par format (md, html, txt en v1 ; pdf en v2) : l'extension future est gratuite.
User value 5 · Feasibility H · Effort M · Next : périmètre v1 du PRD

### 2. Lecture/édition Markdown fluide — **DO FIRST**
Bascule rendu ↔ source en une touche (ou WYSIWYG à la Typora, à trancher au PRD). Le repo existant sert de référence directe.
User value 5 · Feasibility H (référence existante) · Effort M · Next : examiner le repo existant

### 3. Confort de lecture — **DO FIRST**
Thèmes crème/sombre, largeur de colonne réglable, mode focus, table des matières auto en sidebar.
User value 4 · Feasibility H · Effort S · Next : spec UX avec Claude design

### 4. Navigation dossier, wikilinks, recherche — **QUICK WINS**
Explorateur latéral d'un dossier, liens `[[note]]` cliquables sans base de données, recherche plein texte façon grep dans le dossier.
User value 4 · Feasibility H · Effort M · Next : v1 (explorateur + wikilinks), v1.5 (recherche)

### 5. Petits plus quotidiens — **QUICK WINS**
Coller intelligent (image du presse-papier sauvée à côté du md et liée), fenêtre épinglée toujours au-dessus, snapshots auto à chaque sauvegarde.
User value 4 · Feasibility H · Effort S · Next : backlog v1/v1.5

### 6. Export un clic — **CONSIDER (v1.5)**
Md → PDF / HTML / DOCX ; plus tard l'inverse (extraction PDF → texte).
User value 3 · Feasibility H · Effort M · Next : v1.5

### 7. PDF : lecture puis annotations — **CONSIDER (v2)**
Viewer PDF (pdf.js ou équivalent ARM64-friendly), puis surlignage et notes en marge stockées à part en md.
User value 4 · Feasibility M · Effort L · Next : v2, après stabilisation du cœur

### 8. Copilote IA local sur NPU — **CONSIDER (v2+, différenciateur)**
Petit modèle local (type Gemma 3n E4B ou plus petit) tournant sur le NPU Snapdragon X Elite quand l'app est ouverte : questions/réponses et résumés sur les documents ouverts, 100 % local.
User value 4 · Differentiation 5 · Feasibility M (à valider : runtime NPU ARM64) · Effort L · Next : `/gate feasibility` dédié avant de le promettre

## Parked ideas
- Portable zéro-install — déprioritisé par l'utilisateur : un installateur est accepté si l'app est rapide et puissante
- Édition en place paragraphe par paragraphe — fusionnée dans le concept 2 (le mode WYSIWYG/bascule couvre le besoin)

## Discarded
- Rien de rejeté à ce stade — tout est retenu et phasé (v1 / v1.5 / v2)

## Next steps
1. `/create-prd` — cadrer la v1 (concepts 1-5) avec phasage v1.5/v2 ; fournir le chemin du repo de référence
2. `/gate feasibility` — valider le copilote IA local sur NPU ARM64 (concept 8) avant engagement
3. `/architect-design` — choix de stack **compatible Windows ARM64 natif** (Tauri, Electron, .NET…)
