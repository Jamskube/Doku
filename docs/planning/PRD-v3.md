# PRD : Doku v3 — bureau scindé et notes liées

_Date : 2026-08-13 · Statut : Reviewed · Version : 3.0_

## 1. Overview

Doku v3 ajoute un **bureau scindé** permettant d’afficher côte à côte un document source et une note Markdown, ou deux documents déjà ouverts. Le premier incrément vise les utilisateurs qui lisent, comparent et prennent des notes : il réduit les changements d’application tout en conservant des fichiers ordinaires, enregistrés avec les garanties existantes de Doku.

La capacité centrale est volontairement étroite : **ouvrir une seconde surface documentaire, y écrire indépendamment et y capturer un passage avec sa provenance**. Les annotations PDF écrites dans le fichier, l’édition DOCX, le canevas libre et l’édition Markdown par blocs restent hors de cet incrément.

## 2. Problem statement

Aujourd’hui, Doku n’affiche qu’un document actif. Pour prendre des notes pendant une lecture, comparer deux fichiers ou conserver un extrait, l’utilisateur doit changer d’onglet et perdre le contexte visuel, ou ouvrir une autre application. Cette rupture est particulièrement coûteuse lors de la lecture d’un rapport long : la source, la formulation en cours et la provenance de l’extrait ne sont jamais visibles ensemble.

Le problème n’est pas l’absence d’un nouveau format de notes. Il est l’absence d’un espace de travail où **source et production restent simultanément visibles, navigables et sauvegardées sans ambiguïté**.

## 3. Target users

| Persona | Objectif | Douleur actuelle |
|---|---|---|
| **Lecteur-annotateur** | Lire un rapport et consigner des passages importants | Change d’onglet, copie sans provenance, perd l’emplacement d’origine |
| **Rédacteur** | Comparer une référence et son brouillon pendant la rédaction | Alterne entre deux onglets et ne voit jamais les deux versions ensemble |
| **Organisateur** | Produire une note Markdown durable à partir de plusieurs documents | Les extraits s’accumulent sans relation navigable avec leur source |

## 4. Functional requirements

### FR-1 : Ouvrir et fermer le bureau scindé

Description : l’utilisateur peut transformer la zone documentaire en deux surfaces adjacentes et y choisir immédiatement un onglet existant ou une nouvelle note, sans ouvrir une deuxième fenêtre Doku.

User story : En tant que lecteur-annotateur, je veux afficher une seconde surface, afin de garder ma source visible pendant que je prends des notes.

Acceptance :
- Given un document actif, When l’utilisateur déclenche « Scinder la vue », Then Doku affiche une surface secondaire et propose les autres documents ouverts ainsi que « Nouvelle note ».
- Given le sélecteur du volet secondaire, When l’utilisateur choisit un document différent ou « Nouvelle note », Then ce contenu est monté dans le volet sans modifier l’ordre des onglets.
- Given une largeur de fenêtre inférieure à 720 px, When l’utilisateur scinde la vue, Then Doku utilise une disposition verticale plutôt que de rendre les deux surfaces illisibles.
- Given un bureau scindé, When l’utilisateur le referme, Then la surface secondaire disparaît sans fermer son onglet ni perdre son état non enregistré.

Priority : P0

### FR-2 : Choisir le contenu de chaque surface

Description : chaque surface peut afficher un onglet ouvert pris en charge par Doku ; un même onglet ne peut pas être édité simultanément dans les deux surfaces du premier incrément.

User story : En tant que rédacteur, je veux choisir quels documents comparer, afin de travailler sans réordonner mes onglets.

Acceptance :
- Given au moins deux onglets ouverts, When l’utilisateur choisit un onglet pour la surface secondaire, Then cet onglet apparaît sans modifier l’ordre des onglets.
- Given un onglet déjà affiché dans l’autre surface, When l’utilisateur tente de le sélectionner, Then Doku désactive ce choix et explique « Déjà affiché dans l’autre volet ».
- Given l’onglet secondaire fermé depuis la barre d’onglets, When le bureau reste scindé, Then Doku affiche le sélecteur de document dans ce volet et conserve le document principal.

Priority : P1

### FR-3 : Créer une note liée

Description : depuis une surface source, l’utilisateur peut créer un onglet Markdown non enregistré destiné à ses notes, puis l’enregistrer explicitement avec un vrai flux Enregistrer sous.

User story : En tant que lecteur-annotateur, je veux créer une note à côté de ma source, afin de commencer immédiatement sans choisir prématurément son emplacement final.

Acceptance :
- Given un document enregistré nommé `rapport.pdf`, When l’utilisateur choisit « Nouvelle note liée », Then Doku ouvre un onglet Markdown non enregistré nommé `Notes — rapport` dans l’autre surface.
- Given une note liée non enregistrée, When l’utilisateur presse Ctrl+S, Then un dialogue Enregistrer sous s’ouvre avec le nom proposé `notes-<source>.md` et le filtre Markdown ; aucune écriture n’a lieu avant confirmation.
- Given le dialogue Enregistrer sous, When l’utilisateur annule, Then l’onglet conserve son contenu, son état modifié et son absence de chemin.
- Given un chemin confirmé sans extension, When l’utilisateur valide, Then Doku ajoute `.md`, écrit atomiquement, puis met à jour `path`, `name`, `savedContent`, l’index de recherche et la session uniquement après le succès de l’écriture.
- Given un fichier existant choisi, When le dialogue natif confirme son remplacement, Then Doku effectue l’écriture atomique et crée ensuite le premier snapshot de la note.
- Given une erreur d’écriture, When la sauvegarde échoue, Then le chemin et `savedContent` de l’onglet restent inchangés et une notification propose de réessayer.
- Given une source sans chemin sur disque, When l’utilisateur crée une note liée, Then la note est créée sans relation persistante et Doku l’indique comme « Note temporaire ».

Priority : P0

### FR-4 : Capturer un passage avec sa provenance

Description : une sélection textuelle peut être ajoutée à la note de l’autre surface sous une forme Markdown canonique, lisible sans Doku et enrichie d’un ancrage interne strict.

User story : En tant qu’organisateur, je veux capturer un passage et sa source, afin de pouvoir le comprendre et le retrouver plus tard.

Acceptance :
- Given une sélection non vide dans un Markdown ou un fichier texte et une note Markdown dans l’autre surface, When l’utilisateur choisit « Ajouter aux notes », Then Doku insère exactement la forme canonique suivante, avec les fins de ligne de la note, sans modifier le document source :

  ```markdown
  > <chaque ligne de la sélection, avec un préfixe « > »>
  >
  > — Source : `<nom du fichier>`, ligne <N>
  <!-- doku-citation:v1 {"path":"<chemin>","line":N,"col":N,"length":N,"quoteSha256":"<sha256>","prefix":"<0..64 caractères>","suffix":"<0..64 caractères>"} -->
  ```

- Given une sélection contenant CRLF, caractères de contrôle ou Unicode décomposé, When Doku construit l’ancrage, Then il normalise le texte en LF + Unicode NFC pour le hash, retire les contrôles hors tabulation/retour à la ligne et échappe le contenu pour que le commentaire reste un JSON valide.
- Given aucune note Markdown dans l’autre surface, When l’utilisateur choisit « Ajouter aux notes », Then Doku propose de créer une note liée avant toute insertion.
- Given une sélection supérieure à 20 000 caractères, When l’utilisateur tente la capture, Then Doku refuse l’insertion, conserve la sélection et affiche une notification expliquant la limite.
- Given un PDF ou un HTML rendu, When aucune sélection textuelle fiable n’est disponible, Then l’action n’est pas affichée ; Doku ne prétend pas avoir capturé le passage.

Priority : P1

### FR-5 : Naviguer entre l’extrait et sa source

Description : les citations créées par Doku ramènent au document et au passage d’origine quand celui-ci peut encore être localisé sans ambiguïté.

User story : En tant que lecteur-annotateur, je veux revenir d’une note à la source, afin de vérifier le contexte d’un extrait.

Acceptance :
- Given une citation dont la source est ouverte, When l’utilisateur active son lien, Then Doku focalise la surface de la source et révèle le passage avec le halo transitoire existant, sans ouvrir le menu de réécriture.
- Given une citation dont la source est fermée mais accessible, When l’utilisateur active son lien, Then Doku ouvre le fichier dans la surface libre ou remplace la surface source après confirmation si les deux sont occupées.
- Given une citation valide, When Doku relocalise le passage, Then il vérifie d’abord `line`/`col` + hash, puis cherche le texte exact et départage uniquement une occurrence dont `prefix`/`suffix` correspondent ; toute égalité restante est considérée ambiguë.
- Given une source déplacée, un passage modifié ou plusieurs correspondances ambiguës, When la localisation exacte échoue, Then Doku ouvre le document sans faux surlignage et affiche « Passage d’origine introuvable » ou « Plusieurs passages correspondent ».
- Given un commentaire `doku-citation` forgé, When le chemin contient une URL, un chemin UNC, un chemin de périphérique Windows, un caractère de contrôle, une traversée résiduelle après canonicalisation ou une extension non prise en charge, Then Doku refuse l’ouverture et affiche « Source non sûre ».
- Given une citation reconnue, When elle est activée, Then Doku déclenche une action applicative contrôlée ; aucun `href`, `file:` ou protocole personnalisé présent dans le Markdown n’est navigué directement par la webview.

Priority : P1

### FR-6 : Éditer et sauvegarder sans ambiguïté

Description : chaque surface possède son focus, son scroll et sa sélection ; un `activePaneId` explicite et un registre `paneId → tabId/editor` déterminent la cible de toute commande.

User story : En tant que rédacteur, je veux savoir quel document recevra ma frappe ou ma sauvegarde, afin d’éviter toute modification accidentelle.

Acceptance :
- Given deux documents éditables, When l’utilisateur clique dans une surface puis presse Ctrl+S, Then seul le document de cette surface est sauvegardé et snapshoté.
- Given le focus sur la toolbar, le séparateur ou la scrollbar d’un volet, When l’utilisateur presse Ctrl+S, Then Doku cible le dernier `activePaneId` explicite et jamais le dernier éditeur monté.
- Given une sauvegarde asynchrone en cours, When l’utilisateur change de volet ou permute les surfaces, Then l’opération conserve le snapshot `{paneId, tabId, content}` capturé avant le premier `await`.
- Given l’onglet d’un volet fermé, When une commande clavier arrive avant le remontage du sélecteur, Then elle est ignorée avec sécurité et ne retombe pas sur l’autre volet.
- Given deux documents modifiés, When l’utilisateur ferme Doku, Then le dialogue de fermeture existant énumère les deux documents et aucune modification n’est perdue.
- Given le focus clavier dans une surface, When l’utilisateur utilise les commandes d’édition, Then aucune commande n’est envoyée à l’éditeur de l’autre surface.
- Given deux surfaces, When l’une est en lecture PDF ou HTML, Then Ctrl+S ne peut pas écraser son fichier binaire ou rendu.

Priority : P0

### FR-7 : Redimensionner, permuter et restaurer le bureau

Description : l’utilisateur peut ajuster la proportion des surfaces, les permuter et retrouver la disposition à la session suivante.

User story : En tant que rédacteur, je veux adapter l’espace à mon travail, afin de privilégier la source ou la note sans perdre ma disposition.

Acceptance :
- Given une fenêtre d’au moins 720 px, When l’utilisateur déplace le séparateur, Then chaque surface conserve au moins 280 px et la proportion est enregistrée entre 25 % et 75 %.
- Given le séparateur focusé au clavier, When l’utilisateur presse Flèche gauche/droite ou haut/bas selon l’orientation, Then la proportion change par pas de 5 points ; Home/End applique 25 %/75 %.
- Given un bureau scindé valide à la fermeture, When Doku redémarre, Then il lit un schéma de session versionné `{version, split, activePaneId, primaryPath, secondaryPath, ratio}`, restaure d’abord les onglets enregistrés par chemin puis assigne les volets ; un chemin manquant produit un volet vide explicite et l’orientation est redérivée de la largeur courante.
- Given une note sans chemin au moment de la fermeture, When la session est écrite, Then cette note n’est pas sérialisée et le volet correspondant redémarre vide avec le message « Note non enregistrée non restaurée ».
- Given un redémarrage, When les volets sont restaurés, Then leur scroll et sélection repartent aux valeurs du système actuel ; ces états doivent survivre à une permutation pendant la session, mais ne sont pas promis entre deux lancements.
- Given l’action « Permuter les volets », When elle est déclenchée, Then les documents changent de côté sans perdre scroll, sélection ou modifications.

Priority : P1

## 5. Non-functional requirements

| Catégorie | Exigence | Cible mesurable | Mesure |
|---|---|---|---|
| Fiabilité | Aucun changement de sérialisation causé par l’affichage scindé | 100 % des fichiers du corpus round-trip restent octet-identiques sans édition | Tests automatisés du corpus existant |
| Fiabilité | Une surface ne sauvegarde jamais le buffer de l’autre | 0 sauvegarde croisée sur 100 alternances de focus automatisées | Test d’intégration focus → édition → sauvegarde |
| Performance | Ouverture ou fermeture du bureau | état interactif en ≤ 300 ms sur la machine ARM64 de référence | trace `performance.mark` en build release |
| Performance | Frappe avec deux Markdown de 500 Ko | p95 des traitements UI ≤ 16 ms, aucune tâche longue > 50 ms sur 60 s | profil Chromium/WebView2 |
| Accessibilité | Contrôle complet au clavier | 100 % des actions FR-1, FR-2 et FR-7 sans souris ; focus visible en clair et sombre | parcours manuel + tests Playwright |
| Accessibilité | Mouvement réduit | aucune transition de layout > 1 ms avec `prefers-reduced-motion: reduce` | style calculé + capture Playwright |
| Compatibilité | Formats affichables | Markdown/TXT éditables ; HTML/PDF en lecture seule, sans nouveau chemin d’écriture | matrice de tests par format |
| Sécurité | Citation et libellé issus d’un document non fiable | 0 HTML injecté, 0 navigation webview ; rejet de 100 % du corpus URL/UNC/device/traversée/contrôles | tests avec noms, métadonnées et chemins hostiles |
| Résilience | Fichier secondaire supprimé ou illisible | surface principale reste utilisable et notification non bloquante en ≤ 1 s | smoke natif avec suppression externe |

## 6. Scope

### IN

- Deux surfaces documentaires dans la fenêtre principale, parce que c’est le minimum qui supprime le changement permanent d’onglet.
- Markdown et texte éditables dans chaque surface ; HTML et PDF lisibles.
- Création d’une note Markdown non enregistrée et nouveau flux Enregistrer sous atomique pour les onglets texte sans chemin.
- Capture d’une sélection Markdown/TXT sous forme de citation portable avec provenance.
- Navigation retour vers la source, redimensionnement, permutation et restauration de session.
- Réutilisation stricte des primitives existantes d’ouverture, sauvegarde atomique, snapshots, rechargement externe et révélation de passage.

### OUT

| Élément | Reporté à |
|---|---|
| Surlignage/commentaire directement sur un PDF | Gate de faisabilité puis incrément « carnet PDF » |
| Couche d’annotation PDF Doku | Incrément suivant, après validation du modèle de notes liées |
| Édition DOCX | Gate dédié sur la fidélité Office Open XML |
| Canevas spatial libre | Après stabilisation des notes liées et citations |
| Glisser-déposer arbitraire de blocs entre documents | Incrément « édition Markdown par blocs » |
| Plus de deux surfaces simultanées | Mesure d’usage du bureau à deux volets |
| Synchronisation cloud ou collaboration temps réel | Hors trajectoire locale actuelle |

### Assumptions

- Deux instances CodeMirror peuvent coexister sans dépasser les cibles ARM64. Si faux, la seconde surface bascule en lecture seule jusqu’au focus.
- Le modèle actuel `DocTab` peut rester la source de vérité partagée par la barre d’onglets et les deux surfaces, tandis qu’un `PaneState` porte seulement l’affichage et le focus. Si faux, les buffers devront être extraits du store sans jamais être dupliqués par surface.
- Une citation Markdown portable peut contenir assez de provenance pour rester utile sans format propriétaire. Si faux, Doku ajoutera uniquement un index AppData optionnel, jamais des métadonnées opaques obligatoires dans la note.
- La sélection PDF n’est pas fiable dans le lecteur canvas actuel ; elle reste explicitement hors du premier incrément.

## 7. User journeys

### Journey principal — lire et prendre des notes

| # | Action utilisateur | Réponse système |
|---|---|---|
| 1 | Ouvre `rapport.pdf` | Doku affiche le PDF dans la surface principale |
| 2 | Choisit « Scinder la vue » puis « Nouvelle note liée » | Une note `Notes — rapport` apparaît dans la surface secondaire |
| 3 | Écrit ses observations | Seule la note reçoit la frappe ; le PDF conserve sa page et son zoom |
| 4 | Enregistre la note | Le dialogue Enregistrer sous choisit un `.md`, puis Doku utilise la sauvegarde atomique et le snapshot existants |
| 5 | Ferme puis relance Doku | Les deux onglets et leur disposition sont restaurés si leurs chemins existent |

### Journey secondaire — capturer depuis un Markdown

| # | Action utilisateur | Réponse système |
|---|---|---|
| 1 | Affiche une source Markdown et une note | Les deux documents restent visibles |
| 2 | Sélectionne un passage puis « Ajouter aux notes » | Doku insère une citation et sa provenance à la position du curseur de la note |
| 3 | Clique la provenance | Doku focalise la source et révèle le passage sans ouvrir le menu de réécriture |

### Edge cases

- Note liée non enregistrée au redémarrage : elle suit la politique actuelle des onglets sans chemin ; aucune promesse de restauration après crash tant qu’elle n’est pas enregistrée.
- Source renommée ou déplacée : ouvrir la note reste possible ; la navigation indique que la source est introuvable.
- Deux surfaces modifiées : fermeture soumise au dialogue multi-document existant.
- Fenêtre très étroite : orientation verticale automatique, sans masquer les actions de sauvegarde ou de fermeture.

## 8. Success metrics

| Métrique | Cible | Baseline | Mesure |
|---|---|---|---|
| Changements d’onglet pendant une session lecture + notes de 10 min | ≤ 2 | À mesurer, attendu > 10 aujourd’hui | observation sur 5 sessions réelles |
| Extraits capturés avec provenance exploitable | ≥ 90 % retrouvés en un clic après 7 jours | copie manuelle sans provenance | audit de 20 extraits réels |
| Sauvegarde dans le mauvais document | 0 incident sur 30 jours | risque non applicable en vue unique | journal d’incidents utilisateur |
| Usage du bureau scindé | utilisé dans ≥ 3 des 5 sessions d’étude de 10 minutes réalisées sur 2 semaines | 0 session | journal manuel daté, sans télémétrie ni compteur caché |
| Régression du démarrage à froid | ≤ +100 ms par rapport à la release précédente quand le bureau n’est pas restauré | release 2.2.0 | 20 mesures release ARM64 |

## 9. Risks

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Deux éditeurs partagent ou écrasent la référence globale `editorRef` | Haute | Haut | Remplacer la référence globale par un registre indexé par volet avant de monter le second éditeur |
| Le modèle `activeTab()` unique fuit dans les composants | Haute | Haut | Introduire un contexte de surface explicite et interdire les lectures implicites dans `DocumentView` |
| Rendu de deux gros documents dégrade fortement ARM64 | Moyenne | Haut | Kill-test 2 × 500 Ko avant construction complète ; mode secondaire lecture seule si le seuil échoue |
| Capture de provenance casse après modification de la source | Moyenne | Moyen | Stocker passage + chemin + position indicative ; relocaliser par contenu et échouer honnêtement sans faux halo |
| Interaction divider/onglets/copilote devient chargée | Moyenne | Moyen | UX dédiée, contrôle clavier, vérification à 1280×720 et largeur minimale 720 px |
| Portée dérive vers PDF/DOCX/canevas | Haute | Moyen | Gate et artefact séparé pour chaque format ; aucun code correspondant dans ce premier plan |

## 10. Timeline & milestones

| Jalon | Contenu | Critère de sortie |
|---|---|---|
| M0 — Faisabilité | Deux surfaces factices, deux éditeurs, focus, Enregistrer sous et perf | kill-test PASS, sauvegarde d’un onglet sans chemin et aucune sauvegarde croisée |
| M1 — Modèle de surfaces | `PaneState`, sélection d’onglet, restauration | tests unitaires et session verte |
| M2 — Interaction | divider, permutation, clavier, responsive | parcours Playwright clair/sombre et mouvement réduit |
| M3 — Notes liées | création, capture, provenance, retour source | corpus de citations et erreurs vert |
| M4 — Preuve release | tests, build, smoke natif ARM64/x64 | aucun critère P0 ouvert, evidence bundle complet |

## 11. Open questions

1. Le raccourci clavier de « Scinder la vue » doit-il être ajouté dès le premier incrément ou après observation du geste dans l’interface ?
2. Quand les deux surfaces sont occupées et qu’un lien cible un troisième document, faut-il remplacer la source après confirmation ou ouvrir le document dans l’onglet actif sans changer les surfaces ? À résoudre dans la spécification UX.
3. Le séparateur doit-il être horizontalement ou verticalement orienté par choix utilisateur en plus du basculement responsive automatique ? Le P0 n’exige que le comportement automatique.
