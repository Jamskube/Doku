// Détection des fichiers non affichables (FR-1, story 1.2) : binaire (octet NUL)
// ou encodage non-UTF-8 (décodage permissif → caractères de remplacement U+FFFD).
// Logique pure, testable hors natif. Renvoie un message FR si non supporté, sinon
// null. Le déclencheur principal reste que Tauri `readTextFile` lève sur UTF-8
// invalide (géré côté appelant) ; ceci couvre le cas d'un décodage permissif.

// Au-delà de ce ratio de caractères de remplacement, le contenu n'est pas de
// l'UTF-8 valide (quelques U+FFFD peuvent apparaître légitimement dans un texte).
const REPLACEMENT_RATIO = 0.02

export function detectUnsupported(content: string, name?: string): string | null {
  const label = name ? `« ${name} »` : 'Ce fichier'
  if (content.includes('\u0000')) {
    return `${label} : fichier binaire, impossible à afficher.`
  }
  const replacements = (content.match(/\uFFFD/g) ?? []).length
  if (replacements > 0 && replacements / content.length > REPLACEMENT_RATIO) {
    return `${label} : encodage non pris en charge (non-UTF-8).`
  }
  return null
}
