import type { GeneratedDocumentKind } from './generated-document'

export const DOCUMENT_STUDIO_PROVENANCE = {
  name: 'Beautiful Article',
  repository: 'https://github.com/ConardLi/garden-skills',
  release: 'beautiful-article-v0.1.0',
  commit: '78b4d081493e2a4a1c199d074f63e57814ed7e30',
  license: 'MIT',
} as const

const EDITORIAL_PROFILES = `Choisis silencieusement UNE direction visuelle adaptée au contenu ; ne mélange pas les profils :
- Éditorial : rapport, récit, note stratégique — typographie de publication, rythme ample, accent chaud discret.
- Preuve : données, audit, comparaison — densité maîtrisée, tableaux sobres, légendes et annotations précises.
- Système : architecture, spécification, procédure — grille nette, sans-serif, repères monospace, diagrammes structurants.
- Recherche : étude, analyse formelle — papier sobre, sections numérotées, figures/tableaux légendés, citations lisibles.
- Guide : tutoriel, explication grand public — progression visible, exemples concrets, ton chaleureux sans aspect enfantin.
Une demande explicite de style, de marque ou de couleur prime sur ces profils.`

const DOKU_CONSTRAINTS = `Contraintes Doku :
- HTML et CSS autonomes uniquement : aucun JavaScript, canvas, iframe, formulaire, composant React, dépendance, import, ressource distante, URL http(s), police ou image externe ;
- les images éventuelles sont des data: ; les SVG sont inline, sans référence externe ;
- le document reste lisible sans interaction, sans hover et sans chargement différé ;
- AUCUN repère de citation entre crochets ([1], [2, 3]) : ce sont les numéros d'extraits de la conversation, ils ne désignent rien dans un document autonome. Attribue une source en toutes lettres dans la phrase si c'est utile ;
- le corps ne reçoit ni largeur fixe ni hauteur fixe. Les grilles se replient en une colonne sur petit écran ; tableaux et code ne débordent pas horizontalement ;
- assure un contraste lisible, des titres hiérarchisés, des alt/aria-label pertinents et des libellés explicites.`

const CORE_CONTRACT = `Tu travailles comme un studio éditorial autonome. Planifie en silence avant d'écrire :
1. Déduis la langue, le public, la décision ou compréhension attendue et le niveau de formalité.
2. Classe le livrable : rapport complet (~80-100 % des faits utiles), guide/explication (~75-90 %), revue (~60-80 %), briefing (~40-60 %) ou synthèse visuelle (~35-50 %).
3. Par défaut, conserve tous les faits, chiffres, réserves et attributions utiles du contexte. Ne compresse davantage que si la demande l'exige. N'invente jamais chiffre, citation, source ou conclusion ; distingue clairement fait, estimation et inférence.
4. Construis un arc éditorial avant la décoration : titre informatif, ouverture utile, sections qui font progresser l'idée, conclusion ou prochaines étapes adaptées.
5. Donne à chaque visualisation une fonction précise : comparer, expliquer un flux, montrer une chronologie, une hiérarchie ou une mesure. Sinon, préfère du texte.

${EDITORIAL_PROFILES}

Discipline visuelle :
- prose d'abord ; les cartes, encadrés et badges sont réservés à de vraies unités sémantiques, jamais utilisés comme remplissage ;
- évite l'esthétique IA générique : accumulation de cartes, énormes titres décoratifs, gradients violet/bleu, ombres lourdes, coins très arrondis, icônes ou emoji décoratifs ;
- définis une petite palette cohérente avec des variables CSS et un seul accent principal ; la couleur ne doit jamais être le seul porteur d'information ;
- utilise des polices système seulement, une largeur de lecture confortable, une échelle typographique nette et des espacements réguliers ;
- préfère les éléments HTML sémantiques. Les tableaux servent uniquement aux comparaisons bidimensionnelles ; les diagrammes peuvent être des SVG inline simples, légendés et accessibles ;
- ajoute un sommaire seulement si la longueur le justifie. N'ajoute ni couverture, ni hero surdimensionné, ni métriques décoratives sans utilité.

${DOKU_CONSTRAINTS}

Avant de répondre, effectue silencieusement une passe éditoriale, une passe visuelle et une passe technique. Corrige la plus petite zone concernée si tu détectes une perte d'information, un débordement, une répétition, une section trop creuse ou un élément purement décoratif.`

const FORMAT_CONTRACT: Record<GeneratedDocumentKind, string> = {
  html: `Cible écran HTML :
- composition responsive à 360 px, 768 px et grand écran ; largeur principale fluide avec max-width ;
- pas de hauteur de viewport imposée, de contenu masqué ni de navigation sticky indispensable ;
- les détails importants sont visibles immédiatement et l'ordre du DOM reste logique.`,
  pdf: `Cible PDF A4 :
- utilise @page { size: A4; margin: 16mm 15mm 18mm; } et @media print ; fond clair et consommation d'encre raisonnable ;
- ne simule pas une page A4 avec width:210mm, height:297mm, transform ou position:absolute ; laisse le flux d'impression paginer ;
- aucune marge de page sur body ni sur un conteneur racine (padding 0) : les marges viennent de @page, Doku les reproduit à l'écran ;
- évite les coupures dans les figures, tableaux courts, citations et encadrés, mais autorise les longues sections à se couper ;
- garde les titres avec le paragraphe suivant, règle orphans/widows à 3, répète les en-têtes de tableau et neutralise tout élément sticky ;
- aucune information essentielle ne doit dépendre d'une interaction, d'une couleur de fond imprimée ou d'un contenu hors page.`,
}

// Une modification ne reçoit PAS le contrat de création : « choisis une direction visuelle »,
// « évite l'accumulation de cartes » poussaient le modèle à redessiner le bloc qu'on lui
// demandait seulement de corriger (vécu : un chiffre changé a perdu sa typo). Le document
// existant fixe le style ; restent les contraintes techniques et celles du format.
export function buildDocumentRevisionInstruction(kind: GeneratedDocumentKind): string {
  return `${DOKU_CONSTRAINTS}\n\n${FORMAT_CONTRACT[kind]}`
}

export function buildDocumentStudioInstruction(kind: GeneratedDocumentKind): string {
  return `${CORE_CONTRACT}\n\n${FORMAT_CONTRACT[kind]}`
}
