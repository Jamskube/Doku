# Brainstorm: atelier documentaire

_Date : 2026-08-13 · Problème : Comment faire de Doku l’espace principal pour lire, éditer et prendre des notes sur Windows, afin que l’utilisateur puisse gérer ses documents quotidiens sans changer constamment d’application, tout en préservant fidèlement les fichiers d’origine ? · Technique : SCAMPER · Idées générées : 28_

## Top concepts (prioritized)

### 1. Bureau scindé document + notes

Afficher deux surfaces synchronisées : document et notes, deux documents, ou PDF et carnet. Les extraits glissés d’un côté vers l’autre conservent leur provenance et un clic permet de revenir à la source.

- Idée d’origine : **13**, complétée par **5**
- Scores : valeur utilisateur **5/5** · faisabilité **5/5** · différenciation **3/5** · risque **2/5**
- Faisabilité : haute · Effort : M
- Next step : rédiger le flux précis de création, liaison et navigation des notes dans un PRD de fonctionnalité.

### 2. Carnet d’annotations PDF non destructif

Permettre de surligner, commenter et classer des passages d’un PDF, puis de retrouver toutes les annotations dans un carnet lié au document. Le premier palier stocke les annotations dans une couche Doku séparée afin de préserver le PDF original ; l’écriture d’annotations dans le PDF restera une extension explicite. Les annotations sont bien une notion native du format PDF, et PDF.js expose déjà des modes de rendu et d’édition, mais l’ancrage durable et l’export demandent un spike ciblé ([PDF Association](https://pdfa.org/glossary-of-pdf-terms/), [API PDF.js](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)).

- Idées d’origine : **3**, **9** et **27**
- Scores : valeur utilisateur **5/5** · faisabilité **4/5** · différenciation **5/5** · risque **3/5**
- Faisabilité : moyenne à haute · Effort : M
- Next step : lancer un gate de faisabilité sur la sélection de texte, l’ancrage après modification du fichier et l’export portable.

### 3. Inspecteur de conversion avec aperçu des pertes

Convertir Markdown, DOCX, HTML et PDF sans prétendre que tous les passages sont réversibles. Avant l’écriture, Doku compare l’original et le résultat, signale les éléments simplifiés ou perdus, puis propose « remplacer », « enregistrer une copie » ou « annuler ».

- Idées d’origine : **16**, complétée par **23** et **28**
- Scores : valeur utilisateur **5/5** · faisabilité **4/5** · différenciation **4/5** · risque **3/5**
- Faisabilité : moyenne · Effort : M
- Next step : définir une matrice de fidélité par format et limiter le premier palier à deux conversions maîtrisées.

### 4. Édition Markdown par blocs

Manipuler titres, paragraphes, listes, tableaux et médias comme des blocs déplaçables, tout en gardant le fichier Markdown comme source de vérité. Le déplacement doit produire un diff minimal et prévisible, jamais une re-sérialisation globale du document.

- Idées d’origine : **7**, complétée par **1**, **12** et **22**
- Scores : valeur utilisateur **4/5** · faisabilité **3/5** · différenciation **4/5** · risque **5/5**
- Faisabilité : moyenne · Effort : L
- Next step : prototyper uniquement le déplacement d’un bloc simple et mesurer le round-trip sur le corpus de fidélité existant.

### 5. Éditeur DOCX léger et honnête

Ouvrir et modifier le texte, les styles courants, les tableaux et les images d’un DOCX, avec un badge de compatibilité qui indique ce que Doku garantit. Une édition complète façon Word est hors périmètre : Office Open XML est une norme en quatre parties et sa préservation dépasse largement l’affichage de paragraphes ([ECMA-376](https://ecma-international.org/publications-and-standards/standards/ecma-376/), [Microsoft WordprocessingML](https://learn.microsoft.com/en-us/office/open-xml/word/overview)).

- Idées d’origine : **14**, complétée par **28**
- Scores : valeur utilisateur **5/5** · faisabilité **2/5** · différenciation **4/5** · risque **5/5**
- Faisabilité : basse à moyenne · Effort : L
- Next step : passer un gate de faisabilité avant tout engagement produit, avec un corpus DOCX réel et une liste explicite des éléments préservés.

### 6. Canevas documentaire libre

Créer une surface spatiale où disposer extraits, images, notes et liens vers les documents sources. Le canevas sert à comprendre et organiser un dossier complexe ; il ne devient ni un logiciel de dessin ni un format propriétaire impossible à exporter.

- Idées d’origine : **4**, complétée par **18**
- Scores : valeur utilisateur **4/5** · faisabilité **3/5** · différenciation **5/5** · risque **4/5**
- Faisabilité : moyenne · Effort : L
- Next step : différer jusqu’à ce que les primitives de notes liées et de citation soient stabilisées.

## Impact × effort

### DO FIRST — impact élevé, effort contenu

- **13 + 5** — bureau scindé document + notes.
- **3 + 9 + 27** — annotations PDF, limitées au surlignage et au commentaire dans une couche Doku non destructive.
- **16 + 23** — inspecteur de conversion, d’abord sur les exports déjà maîtrisés.

### QUICK WINS — utiles, mais secondaires

- **15** — mode focus sur le paragraphe courant.
- **17** — note quotidienne accessible en une action.
- **21** — mieux exposer l’historique et la restauration déjà sûrs plutôt que réinventer la sauvegarde.
- **24** — palette universelle pour ouvrir un document, une note ou une commande.

### CONSIDER — planifier après validation des fondations

- **4** — canevas documentaire libre.
- **6** — tâches et échéances dans les notes.
- **7 + 12** — édition Markdown par blocs et composants riches.
- **8** — suivi des modifications et acceptation/rejet.
- **10** — liens, backlinks et renommage cohérent.
- **11** — capture rapide, épingles, tags et dossiers intelligents.
- **14 + 28** — édition DOCX à garanties limitées.
- **18** — classeur de recherche avec citations.
- **19** — boîte de réception documentaire.
- **25** — documents connexes à l’ouverture d’une note.
- **26** — suggestions de classement sans déplacement automatique.

### DISCARD — trop diffus ou absorbé par un meilleur concept

- **1** — « édition visuelle totale » est absorbée par l’édition par blocs, avec une exigence de fidélité plus précise.
- **2** — « remplacer Word, Acrobat et Notes » est une ambition trop large, pas une fonctionnalité testable.
- **20** — transformer les tableaux en formulaires éloigne Doku de son cœur lecture, édition et notes.
- **22** — supprimer toute distinction lecture/édition est absorbé par l’édition directe contrôlée, sans imposer ce comportement à tous les formats.

## Parked ideas

- **Canevas documentaire** — différé jusqu’à l’existence de notes liées et de citations stables.
- **Éditeur DOCX léger** — différé jusqu’au résultat d’un gate de faisabilité et d’un corpus de fidélité.
- **Édition Markdown par blocs** — différée tant que le déplacement minimal sans re-sérialisation n’est pas prouvé.
- **Suivi des modifications, backlinks, recherche structurée et classement assisté** — intéressants après la fondation document + notes.

## Discarded

- **Suite bureautique universelle** — dilue la promesse de Doku et multiplie les formats impossibles à préserver parfaitement.
- **Formulaires depuis les tableaux** — valeur trop éloignée du problème prioritaire.
- **Mode visuel imposé partout** — les formats doivent conserver des garanties différentes et visibles.

## Next steps

1. `/create-prd` pour le concept **#1 Bureau scindé document + notes**, en incluant la provenance des extraits.
2. `/gate feasibility` pour le concept **#2 Carnet d’annotations PDF**, avant de promettre l’ancrage ou l’export.
3. `/architect-design` après validation des deux premiers concepts, afin de partager un même modèle de notes liées.
4. Garder **DOCX** et le **canevas** hors du premier incrément ; les réévaluer après usage réel du bureau scindé.
