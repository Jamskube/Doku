---
target: src/components/CopilotPanel.svelte
total_score: 27
p0_count: 1
p1_count: 3
timestamp: 2026-07-17T07-11-56Z
slug: src-components-copilotpanel-svelte
---
# Critique — CopilotPanel.svelte (Doku-San)

Method: dual-agent (A: ad9c28cca6f5f450c · B: a535a57bf05f4f49c)

## Design Health Score — 27/40 (Acceptable, haut de fourchette)

| # | Heuristique | Score | Problème clé |
|---|---|---|---|
| 1 | Visibilité de l'état système | 3 | Prefill (~45 s au 1er envoi) muet : skeleton sans mot ; fin de téléchargement silencieuse |
| 2 | Correspondance système/monde réel | 3 | « (icône calques) » demande de traduire un nom d'icône ; bouton « Ton » ambigu en FR |
| 3 | Contrôle & liberté | 3 | Pas de « Réessayer » sur échec ; bannière d'erreur modèles sans dismiss |
| 4 | Cohérence & standards | 2 | `confirm()` natif vs ConfirmDialog maison ; « Télécharger »/« Obtenir » ; 3 noms pour la vue modèles |
| 5 | Prévention des erreurs | 3 | Garde zéro-perte exemplaire ; mais suppression du modèle ACTIF sans avertissement dédié |
| 6 | Reconnaissance > rappel | 3 | Badge troncature + variantes Reformuler expliqués uniquement en `title` (invisible clavier/tactile) |
| 7 | Flexibilité & efficacité | 2 | Aucun raccourci panneau/prompt ; pas de resend/regenerate |
| 8 | Esthétique & minimalisme | 3 | 2 boutons morts (« + Contexte », trombone) ; « actif » répété 3× dans la carte héro |
| 9 | Récupération d'erreur | 2 | Pas de retry + `user-select:none` hérité → impossible de copier sa question échouée |
| 10 | Aide & documentation | 3 | Onboarding pédagogique, tooltips honnêtes ; rien au-delà (acceptable) |
| **Total** | | **27/40** | |

## Verdict anti-patterns

**Pas du slop.** Signature réelle : le motif de cartes imbriquées (`.cop-input-field` / `.cop-hero-stats` en chevauchement −15/−16 px) est un geste « papier » cohérent et identifiable. Discipline de palette réelle (un seul vert `--ok`). `deriveParams` refuse d'inventer des chiffres — l'honnêteté comme comportement de design.
- Bans : pas de side-stripe (le `border-left` du blockquote = **faux positif** du détecteur, styling Markdown neutre), pas de gradient text, pas de glassmorphism. **1 hit réel** : eyebrows uppercase 10,5 px sur les 4 sections de la vue modèles (défendable en pane de settings, mais MODÈLE ACTIF est redondant 3×).
- Détecteur CLI : 1 finding (faux positif blockquote). Détecteur in-page : 1 vrai positif dans le panneau (`tiny-text` 10,5 px sur `.cop-disclaimer`) + 1 adjacent (`clipped-overflow-container` sur `.page.with-copilot`, sans artefact visible).
- Navigateur (7 captures light/dark) : police d'icônes OK, zéro débordement horizontal, thème sombre correct. **1 défaut visuel confirmé** : placeholder du textarea sur 2 lignes **rogné** (boîte 30 px / contenu 48 px) avec liseré de scrollbar.

## Impression générale

Un panneau au-dessus de la moyenne, fidèle à la marque « calme/discret », avec une vraie signature visuelle et une éthique d'honnêteté rare. Mais le **parcours de premier lancement se termine sur une fausse erreur** (modèle téléchargé jamais activé), et les textes d'état les plus importants (garde zéro-perte, disclaimer) sont les moins lisibles du panneau. La plus grosse opportunité : faire réussir la première question.

## Ce qui marche

1. **Le motif de chevauchement** (input et carte héro) — signature Doku réutilisable, exécutée aux tokens.
2. **L'honnêteté** : pas de stats inventées, badge de troncature déterministe, messages zéro-perte explicites (« texte d'origine intact »).
3. **La retenue** : un seul accent couleur, skeletons plutôt que spinners, motion 200 ms d'état uniquement, reduced-motion couvert.

## Problèmes prioritaires

- **[P0] Le modèle téléchargé ne devient jamais utilisable seul.** `pullModel` n'active pas le modèle après le pull ; l'onboarding se conclut par une ligne de bibliothèque au point éteint. Première question → carte rouge « La génération a échoué » (alors que rien n'a été généré : pas de modèle actif). Le moment « wow » du produit devient un échec fabriqué. **Fix** : auto-activer après pull si `!app.activeModel` + note discrète « Installé et activé » ; renommer le titre de la carte d'erreur quand c'est un état de config. → `/impeccable onboard`
- **[P1] Contrastes sous le seuil sur les textes qui comptent.** Le fallback `var(--warn, #9a6a2c)` est masqué par le `--warn` global (#D4A23E) : badge « lecture partielle » ≈ 1,7:1, message stale (le plus critique du panneau) ≈ 2,3:1. `.cop-prop-note.ok` ≈ 2,8:1 ; disclaimer 10,5 px ≈ 3,1:1 (mesuré, les 2 thèmes) ; erreur dark ≈ 3,3:1 ; placeholders ≈ 3,1:1. **Fix** : tokens `--warn-text`/`--ok-text` dans les 2 thèmes ; plus de `--ink-5` sous 12 px porteur de sens. → `/impeccable polish`
- **[P1] Échec sans issue.** Pas de « Réessayer » (la maquette le specifiait) ET `user-select:none` hérité sur les bulles → impossible même de copier sa question pour la retaper. **Fix** : bouton Réessayer sur la carte d'erreur + `user-select:text` sur bulles/réponses/proposition. → `/impeccable harden`
- **[P1] Prefill muet (~45 s).** Le 1er envoi sur un vrai doc affiche un skeleton sans mot pendant le spawn+prefill ; l'infra `m.status` existe (résumé) mais pas en Q&A. **Fix** : « Doku-San lit le document… » jusqu'au 1er token. → `/impeccable polish`
- **[P2] Zone de saisie fragile.** Placeholder 2 lignes rogné (confirmé navigateur), focus invisible sur les 2 inputs (`outline:none` bat le ring global), pas d'auto-grow. **Fix** : placeholder court (« Votre question… »), `.cop-input:focus-within`, `field-sizing: content`. → `/impeccable polish`

## Personas — signaux rouges

**Alex (power user)** : aucun raccourci pour ouvrir le panneau/focus le prompt ; échec = retaper de mémoire (pas de retry, texte non sélectionnable) ; l'icône `refresh` de « Nouvelle conversation » se lit « regenerate » et efface la conversation sans confirmation ; chips de suggestion re-téléchargent un modèle déjà installé.
**Sam (a11y)** : AUCUNE région `aria-live` (streaming, statut, erreurs, états Reformuler = silence lecteur d'écran) ; focus invisible sur textarea/input ; l'explication du badge troncature inaccessible clavier/tactile ; le message stale = texte le moins contrasté du panneau ; cibles 24 px.
**Jordan (première fois)** : avant le 1er pull, impossible d'installer autre chose que la reco (la section AJOUTER n'existe que dans la branche non-vide) ; piège du premier lancement (P0) ; le message de récupération dit « (icône calques) ».

## Observations mineures

- Ellipsis inopérant sur `.cop-ctx-chip` (conteneur flex) — noms longs coupés net.
- `border-collapse: collapse` + `border-radius` sur les tables du chat — radius ignoré.
- `formatBytes` → « 1.9 Go » (point) ; le français veut « 1,9 Go ».
- ~20 `style="font-size:NNpx"` inline sur les icônes — 2-3 classes suffiraient.
- `{#each … (i)}` clé par index — bloquera les animations par message.
- 3 boutons pleins subtilement différents (34/28/30 px, radii 9/8/9) — un primitif.
- Bannière d'erreur vue modèles : ni dismiss ni retry.
- Pull multi-Go : % sans octets/débit — un blocage à 63 % est indistinguable d'un progrès.
- « Poser une question dessus » familier ; « Obtenir » vs « Télécharger » ; virgule avant « ou » (l.277).
- README maquette (3b) vs reco câblée (1.5b) — la reco 1.5b est canonique (choix utilisateur 2026-07-16), mettre à jour le README.

## Questions à considérer

1. **Reformuler doit-il vivre dans le panneau ?** La sélection est dans l'éditeur ; les verbes et Accepter/Refuser sont à 344 px. Un popover ancré à la sélection (le panneau ne gardant que le journal) rendrait Accepter un geste sur place.
2. **Si le copilote est un « gadget », pourquoi possède-t-il une surface complète de gestion de modèles ?** Une ligne « modèle : qwen2.5:1.5b ▾ » près de la saisie, avec la gestion exilée dans de vrais réglages, laisserait le panneau n'être qu'une conversation.
3. **Accepter devrait-il montrer ce qui change plutôt que le résultat ?** Un diff mot-à-mot dans la proposition transformerait une relecture comparative en coup d'œil.
