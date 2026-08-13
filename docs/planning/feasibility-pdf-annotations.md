# Faisabilité — carnet d’annotations PDF non destructif

_Date : 2026-08-13 · Verdict : **GO conditionnel** · Portée évaluée : sélection, surlignage, commentaire et persistance séparée_

## Décision

Doku peut livrer un premier carnet d’annotations PDF **sans modifier le PDF** et sans intégrer l’éditeur complet du viewer PDF.js. L’incrément recommandé ajoute une couche texte sélectionnable au-dessus du canvas, convertit la sélection en ancre stable Doku, puis stocke surlignage et commentaire dans AppData. Le PDF reste la source de lecture immuable.

Le GO est conditionné par un spike d’interaction réel : la sélection doit rester correctement alignée à 100 %, 125 % et 150 % de mise à l’échelle Windows, avec pages tournées et texte multi-lignes. Un échec d’alignement ou de relocalisation doit désactiver honnêtement l’annotation sur le document concerné, jamais créer un faux surlignage.

## Ce que le socle actuel prouve déjà

- `pdfjs-dist` 6.1.200 est déjà embarqué localement avec worker Vite et rendu canvas hors ligne.
- `getTextContent()` est déjà utilisé pour extraire le texte page par page.
- `getCitedRects()` sait déjà transformer les coordonnées PDF en rectangles normalisés `0..1` indépendants du DPR et du zoom.
- `PdfView.svelte` sait déjà rendre des overlays de surlignage au-dessus d’une page et révéler une citation.
- Le bureau scindé permet d’afficher le PDF et une note simultanément ; le modèle de citation portable sait conserver texte, contexte et provenance.

## Architecture retenue

### 1. Couche de sélection

Monter une `TextLayer` PDF.js au-dessus de chaque canvas rendu, avec le même viewport CSS que la page. Cette couche sert uniquement à la sélection et à l’accessibilité ; elle ne monte ni `AnnotationLayer`, ni `AnnotationEditorLayer`, ni `ScriptingManager`.

La sélection produit :

```ts
interface PdfSelectionAnchor {
  version: 1
  page: number
  quote: string
  prefix: string
  suffix: string
  pageTextHash: string
  rects: Array<{ left: number; top: number; width: number; height: number }>
}
```

Les rectangles restent une représentation visuelle de repli. La vérité de relocalisation est le triplet `quote + prefix + suffix` dans le texte normalisé de la page.

### 2. Persistance non destructive

Stocker les annotations dans le répertoire AppData de Doku, jamais dans le dossier du PDF sans action explicite :

```text
annotations/
  <document-id>/
    manifest.json
```

`document-id` dérive du chemin canonique et d’une empreinte du fichier. Le manifeste est versionné et écrit atomiquement. Il conserve les ancres, le commentaire Markdown, la couleur parmi une palette fermée, les dates et l’état `resolved | orphaned`.

Le contenu du PDF n’est jamais copié dans le manifeste. Une suppression d’annotation ne touche que le manifeste Doku.

### 3. Relocalisation après changement du PDF

1. Vérifier la page et son `pageTextHash`.
2. Si la page a changé, rechercher `quote` exactement dans cette page.
3. Départager avec `prefix` et `suffix`.
4. Si une occurrence unique reste, recalculer les rectangles depuis les items PDF.js.
5. Sinon conserver l’annotation comme `orphaned`, l’afficher dans le carnet et ne dessiner aucun faux surlignage.

Le déplacement d’une page dans le document n’est pas promis au premier palier. Une recherche document-wide pourra être ajoutée après mesure du coût sur les gros PDF.

### 4. Surface produit

- Sélectionner du texte fait apparaître une action compacte « Surligner » et « Commenter ».
- Un surlignage simple est visible immédiatement ; « Commenter » ouvre une note courte ancrée, sans modal plein écran.
- Le panneau « Annotations » liste les entrées du document, permet le filtrage par couleur et navigue vers la page.
- Une annotation orpheline reste visible avec « Passage introuvable » et peut être supprimée ou rattachée manuellement plus tard.
- Les PDF scannés ou dont la couche texte est inutilisable affichent « Ce PDF ne contient pas de texte sélectionnable » ; aucune annotation textuelle n’est proposée.

## Sécurité

- Conserver le rendu canvas et le worker local existants.
- Ne monter ni couche de scripting, ni liens PDF, ni formulaires, ni éditeur PDF.js.
- Traiter texte, commentaire et métadonnées comme non fiables ; aucun `{@html}`.
- Refuser URL, UNC, chemin de périphérique et traversée lors de toute réouverture depuis un manifeste.
- Limiter le commentaire et la citation en taille ; borner le nombre de rectangles et d’annotations rendues simultanément.

## Kill-tests du spike

| Test | PASS | KILL / repli |
|---|---|---|
| Sélection multi-ligne sur PDF texte | texte et rectangles correspondent au geste | décalage visible ou texte différent |
| Windows 100/125/150 % + DPR 1..3 | erreur visuelle ≤ 2 px CSS | dérive cumulative selon le DPR |
| Page tournée 90/180/270° | rectangles et sélection suivent la page | coordonnées inversées ou hors page |
| PDF deux colonnes | sélection DOM cohérente avec le geste | ordre de lecture mélange les colonnes |
| 200 pages | ouverture interactive et pages paresseuses | TextLayer montée pour toutes les pages au démarrage |
| PDF scanné | annotation textuelle désactivée explicitement | surface vide ou faux texte |
| PDF remplacé | relocalisation unique ou état orphelin | surlignage sur un passage différent |
| Sécurité | zéro navigation et zéro requête réseau | lien/annotation PDF activable |

## Risques

- **TextLayer et canvas se désalignent** avec le zoom/DPR → partager exactement le viewport CSS et tester sur la machine ARM64 réelle.
- **Ordre de lecture PDF ambigu** → ancrer d’abord à la page et à la sélection DOM ; échouer honnêtement sur les colonnes non fiables.
- **API viewer moins stable que l’API display** → importer uniquement `TextLayer` depuis la distribution installée et figer sa version ; ne pas dépendre du viewer complet.
- **Manifeste orphelin après déplacement du PDF** → garder un index par empreinte et proposer une reconnexion explicite, sans scan automatique du disque.
- **Trop d’overlays** → ne monter que les annotations des pages dans la marge de rendu paresseux.

## Hors périmètre du premier palier

- Écriture d’annotations dans le fichier PDF.
- Signature, formulaires, dessin libre, tampons, pièces jointes et réponses imbriquées.
- OCR des PDF scannés.
- Synchronisation cloud ou collaboration.
- Compatibilité complète avec les annotations créées dans Acrobat.

## Sources techniques

- [PDF.js — API de la couche display](https://mozilla.github.io/pdf.js/api/)
- [PDF.js — exemple officiel du viewer composé](https://github.com/mozilla/pdf.js/blob/master/examples/components/simpleviewer.html)
- [PDF.js — FAQ annotations](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#is-it-possible-to-add-annotations-to-a-pdf)
- [PDF Association — objets et annotations PDF](https://pdfa.org/resource/pdf-cheat-sheets/)

## Étape suivante

Créer un spike isolé `spike/pdf-text-selection.html` qui monte canvas + TextLayer sur un petit corpus local, mesure les coordonnées sélectionnées et exécute les kill-tests DPR/rotation avant toute intégration dans `PdfView.svelte`.
