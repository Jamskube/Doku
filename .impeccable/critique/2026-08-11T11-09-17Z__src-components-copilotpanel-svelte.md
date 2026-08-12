---
target: src/components/CopilotPanel.svelte
total_score: 28
p0_count: 0
p1_count: 1
timestamp: 2026-08-11T11-09-17Z
slug: src-components-copilotpanel-svelte
---
Method: dual-agent (A: critique_design · B: critique_detector)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Fournisseur, confidentialité, progression et erreurs sont explicites ; la configuration manquante arrive toutefois après l'envoi. |
| 2 | Match System / Real World | 3 | Le français est naturel, mais `Q4_0`, embedding et les noms Hugging Face percent dans la vue Modèles. |
| 3 | User Control and Freedom | 3 | Arrêt, retour, nouvelle conversation et permutation de contexte existent ; le focus clavier peut se perdre. |
| 4 | Consistency and Standards | 3 | Matériaux cohérents, mais l'onglet Question actif est un `span` alors que Contexte est un bouton. |
| 5 | Error Prevention | 2 | Une action rapide peut publier la demande avant de découvrir qu'aucun modèle n'est actif. |
| 6 | Recognition Rather Than Recall | 3 | Suggestions et contexte sont visibles ; quelques actions d'en-tête restent iconiques. |
| 7 | Flexibility and Efficiency | 2 | Entrée/Shift+Entrée sont prévus, mais le roving tabindex du composeur est cassé. |
| 8 | Aesthetic and Minimalist Design | 4 | Interface calme, lisible, sans glow ni contours superflus. |
| 9 | Error Recovery | 3 | Les erreurs proposent réessayer, choisir ou vérifier le fournisseur. |
| 10 | Help and Documentation | 2 | Bonne microcopie, peu d'aide sur les fonctions désactivées et les termes techniques. |
| **Total** | | **28/40** | **Good** |

## Anti-Patterns Verdict

**LLM assessment:** le panneau ne ressemble pas à un assemblage IA générique. La palette retenue, la relation calme avec la feuille et surtout le composeur imbriqué Question/Contexte lui donnent une identité propre. Seul l'accueil « icône + titre + trois actions fléchées » reste un motif d'assistant assez convenu.

**Deterministic scan:** 122 alertes dans `src/components/CopilotPanel.svelte` : 68 tailles typographiques, 43 rayons, 10 couleurs et 1 police. La majorité est advisory. Le warning police vise volontairement `Material Symbols Rounded`. Plusieurs rayons et micro-tailles sont déjà prescrits par `DESIGN.md` ou `.impeccable/design.json`; ce sont des décalages du frontmatter du design sidecar, pas des défauts produit. Deux rayons inline sont aussi mal parsés par le détecteur. Les couleurs codées en dur doivent en revanche être revues une par une pour vérifier qu'elles expriment bien un état sémantique.

**Visual overlays:** aucun overlay fiable n'est disponible. L'inspection navigateur a réussi, mais le contexte d'évaluation exposé était en lecture seule ; la prévalidation d'injection a donc échoué et aucun serveur auxiliaire n'a été démarré.

## Overall Impression

Doku-San est déjà un compagnon de document crédible et discret. Sa plus grande opportunité n'est pas un redesign : c'est de rendre le composant signature aussi robuste au clavier et au tactile qu'il l'est visuellement.

## What's Working

- Le composeur imbriqué est une vraie signature : profondeur compréhensible, contexte visible et brouillon conservé.
- La hiérarchie respecte le principe « Doku s'efface » : le document reste la surface dominante.
- Les états clair et sombre utilisent des ombres sombres, des surfaces calmes et des erreurs actionnables sans glow.

## Priority Issues

### [P1] Navigation clavier cassée entre Question et Contexte

**Why it matters:** quand Question est actif, son tab est un `span` non focalisable et le tab Contexte vaut `tabindex=-1`. Une flèche tente ensuite de focaliser le `span` et peut laisser l'utilisateur clavier sans cible.

**Fix:** rendre les deux tabs avec de vrais boutons, appliquer un roving tabindex cohérent et transférer explicitement le focus après la permutation.

**Suggested command:** `/impeccable polish`

### [P2] Action « Joindre » visible mais muette

**Why it matters:** le `+` ressemble à une action disponible alors qu'il est définitivement désactivé sans explication.

**Fix:** le masquer tant que la fonction n'existe pas, ou fournir une explication accessible. Le masquage est préférable pour préserver le calme.

**Suggested command:** `/impeccable distill`

### [P2] Configuration manquante découverte après l'envoi

**Why it matters:** le premier geste réussi visuellement devient ensuite un échec de conversation, ce qui fragilise la confiance.

**Fix:** vérifier le runtime avant de publier la demande et conserver l'intention pendant l'ouverture du setup.

**Suggested command:** `/impeccable harden`

### [P2] Vue Modèles trop technique

**Why it matters:** `Q4_0`, embedding et noms de dépôt concurrencent le choix simple d'un fournisseur.

**Fix:** garder une recommandation claire et placer les réglages avancés sous divulgation progressive.

**Suggested command:** `/impeccable clarify`

### [P2] Cibles compactes sur écran tactile

**Why it matters:** plusieurs commandes de 28 à 36 px sont difficiles sur une Surface Pro au doigt.

**Fix:** conserver des glyphes discrets tout en portant les zones interactives importantes vers 40 à 44 px.

**Suggested command:** `/impeccable adapt`

## Persona Red Flags

**Sam (clavier et lecteur d'écran):** ne peut pas parcourir Question/Contexte de façon fiable ; le focus se perd après une flèche. Les cibles de 28 px pénalisent aussi les limitations motrices.

**Jordan (première utilisation):** le `+` désactivé paraît cassé, les termes `Q4_0` et embedding sont indéchiffrables, et la configuration manquante n'est révélée qu'après son premier geste.

**Alex (utilisateur expert):** les raccourcis restent peu découvrables et « Nouvelle conversation » ne restaure pas forcément l'état mental « prêt à écrire ».

## Cognitive Load

Deux échecs sur huit, soit une charge modérée. Le chat principal réussit le focus, le regroupement, la hiérarchie et la divulgation progressive. La vue Modèles échoue « une chose à la fois » et « choix minimaux » en juxtaposant statut, erreur, onboarding, recommandation, saisie et options techniques.

## Emotional Journey

L'entrée est calme et rassurante. La permutation Question/Contexte constitue le meilleur moment du parcours. La vallée apparaît lorsqu'une suggestion produit une bulle utilisateur avant d'annoncer « Aucun modèle actif ». La récupération est claire, mais intervient trop tard.

## Minor Observations

- `MODÈLE ACTIF` et `AJOUTER` en capitales espacées contredisent la nouvelle règle de casse phrase.
- Les métadonnées à 10–10,5 px sont fragiles en zoom et en usage tactile.
- Une nouvelle conversation devrait probablement restaurer la face Question et le focus du champ.
- Le détecteur et le design sidecar ne partagent pas encore exactement les mêmes rampes de rayon et de micro-typographie.

## Questions to Consider

- Pourquoi afficher « Joindre » avant que joindre soit possible ?
- Une nouvelle conversation doit-elle seulement vider l'historique, ou restaurer l'état « prêt à écrire » ?
- Doku doit-il exposer `Q4_0` et Hugging Face, ou garantir simplement « recommandé pour votre appareil » ?
- Et si l'absence de modèle ouvrait le setup avant que la demande n'entre dans la conversation ?
