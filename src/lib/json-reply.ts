// Extraction tolérante d'un objet JSON dans une réponse de modèle.
//
// Un modèle sommé de « répondre uniquement en JSON » enrobe quand même : clôtures
// ```json, phrase d'introduction, commentaire final. Refuser ces réponses ferait échouer
// la fonction pour une politesse. On prend donc de la première `{` à la dernière `}`, et
// on rend `null` plutôt que de jeter — l'appelant décide ce que « illisible » veut dire
// chez lui, et aucun chemin de génération ne casse sur une réponse malformée.
//
// Éprouvé depuis la mémoire cloud (sélection de souvenirs et extraction de mutations) ;
// extrait ici pour que tout chemin à sortie structurée parte du même parseur plutôt que
// d'en réinventer un moins tolérant.
export function extractJsonObject(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}
