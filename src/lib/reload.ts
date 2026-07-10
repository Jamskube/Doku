// Décision de rechargement sur modification externe (FR-3, story 3.5).
// Logique pure (testable hors DOM) : compare le contenu disque au buffer.
//   - unchanged : le disque correspond à la dernière version connue → rien à faire
//   - reload    : recharger silencieusement (pas de modif locale, ou le disque
//                 correspond déjà au buffer édité → on adopte, l'onglet redevient propre)
//   - conflict  : modifications locales non enregistrées ET disque différent → proposer

export type ExternalChange = 'unchanged' | 'reload' | 'conflict'

export function classifyExternalChange(
  disk: string,
  tab: { content: string; savedContent: string },
): ExternalChange {
  if (disk === tab.savedContent) return 'unchanged'
  if (disk === tab.content) return 'reload'
  if (tab.content !== tab.savedContent) return 'conflict'
  return 'reload'
}
