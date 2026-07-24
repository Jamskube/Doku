// Corpus de prefill déterministe pour le spike 17.1 (backend NPU / Foundry Local).
//
// But : fournir une charge d'ENTRÉE reproductible (le prefill), en français, de
// longueur réglable, + une VRAIE tâche de sortie (résumé) pour mesurer le
// bout-à-bout (H1 : la douleur = 1er token, mais l'usage = réponse complète).
//
// Aucune dépendance à l'app. Déterministe (pas de Math.random) → deux runs
// produisent le même prompt, condition d'une comparaison honnête.

// Paragraphes de base : un vrai document technique FR cohérent (gestion de notes
// Markdown), pour que la tâche « résume » soit jugeable en qualité (gate H5) et
// que le français du modèle soit évaluable.
const PARAS = [
  "La gestion locale de connaissances repose sur des fichiers Markdown simples, lisibles sans outil propriétaire. Chaque note est un document autonome, versionnable, que l'on peut ouvrir, éditer et archiver sans dépendre d'un service en ligne. Cette approche privilégie la durabilité du format sur le confort d'une plateforme fermée.",
  "Le liage entre notes s'effectue par des wikilinks de la forme double-crochet, résolus vers le fichier cible du dossier courant ou de ses sous-dossiers. Un cache invalidé par un observateur de fichiers maintient la correspondance à jour, de sorte qu'un clic ouvre toujours la bonne note même après un déplacement ou un renommage.",
  "La recherche plein-texte balaie le dossier de contexte et retourne les fichiers correspondants avec des extraits surlignés. Sur un corpus de l'ordre du millier de notes, la cible de latence reste sous trois cents millisecondes ; une requête modifiée annule la précédente afin d'éviter l'affichage de résultats périmés.",
  "Le rendu respecte la syntaxe Markdown étendue : tableaux, listes de tâches, blocs de code colorés. Le HTML inline est passé par une liste d'autorisation stricte qui neutralise scripts et gestionnaires d'événements, sans quoi un document malveillant pourrait exécuter du code au simple affichage.",
  "L'édition en aperçu direct révèle la syntaxe au niveau du curseur puis re-rend le bloc à la sortie. La sauvegarde est atomique — écriture d'un fichier temporaire puis renommage — afin qu'une coupure d'alimentation ne laisse jamais un document à moitié écrit. Un indicateur signale les modifications non enregistrées.",
  "Le copilote d'assistance fonctionne intégralement hors ligne grâce à un moteur d'inférence local. Aucune requête ne quitte la machine pendant la génération : c'est la garantie de confidentialité qui distingue l'outil des assistants adossés au nuage, où chaque prompt transite par un serveur distant.",
  "Le résumé d'un long document recourt à une segmentation quand le texte dépasse la fenêtre de contexte du modèle. Chaque segment est résumé, puis les résumés sont fusionnés — une réduction par carte qui évite la troncature silencieuse, laquelle ferait perdre la fin du document sans avertir l'utilisateur.",
  "Les questions posées sur un document reçoivent une réponse ancrée sur son contenu. Lorsque l'information demandée est absente, le copilote le dit franchement plutôt que d'inventer ; cette honnêteté est préférée à une complétude trompeuse, car une réponse fabriquée érode la confiance plus qu'une lacune assumée.",
  "L'indexation d'un dossier construit des vecteurs d'embeddings stockés localement, ré-indexés de façon incrémentale au gré des ajouts, modifications et suppressions détectés par empreinte de contenu. Le coût reste borné pour ne pas figer l'application, même sur une machine à ressources modestes dépourvue d'accélérateur dédié.",
  "La lecture des documents au format portable extrait la couche texte page par page dans l'ordre de lecture, quand elle existe. Un document numérisé sans couche texte est détecté et signalé honnêtement : aucune reconnaissance optique n'est tentée, donc aucun faux texte n'est produit et présenté comme fidèle à l'original.",
]

// Assemble un document d'environ `charTarget` caractères en répétant les
// paragraphes avec des en-têtes de section numérotés (cohérence + déterminisme).
export function buildDocument(charTarget) {
  const out = []
  let len = 0
  let section = 1
  let p = 0
  while (len < charTarget) {
    const header = `\n\n## Section ${section} — principe ${section}\n\n`
    const para = PARAS[p % PARAS.length]
    out.push(header, para)
    len += header.length + para.length
    p++
    if (p % PARAS.length === 0) section++
  }
  return out.join('').slice(0, charTarget).trim()
}

// Consigne de tâche réelle (H1 : on veut mesurer une sortie de longueur réaliste,
// pas 64 tokens). Le résumé en ~8 puces force ~300-500 tokens de decode.
export const TASK_INSTRUCTION =
  "Résume le document ci-dessous en huit puces claires et fidèles, en français. " +
  "N'invente aucune information absente du texte. Termine par une phrase de synthèse.\n\n"

// Prompt complet = consigne + document. Le VRAI compte de tokens est relu depuis
// l'API (prompt_eval_count / usage.prompt_tokens), jamais estimé ici (MED M3).
export function buildPrompt(charTarget) {
  return TASK_INSTRUCTION + buildDocument(charTarget)
}

// Jeu de prompts FR courts pour le gate qualité à l'aveugle (H5), indépendants
// de la charge de prefill : on juge fidélité + français, pas la vitesse.
export const QUALITY_PROMPTS = [
  "Explique en trois phrases la différence entre une sauvegarde atomique et une sauvegarde directe, et pourquoi la première protège d'une coupure d'alimentation.",
  "Qu'est-ce qu'un wikilink et comment sa cible reste-t-elle correcte après le renommage d'une note ? Réponds en français clair.",
  "Pourquoi un copilote hors ligne est-il préférable à un assistant adossé au nuage pour des notes confidentielles ? Deux arguments.",
]
