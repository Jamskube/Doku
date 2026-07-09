import type { DocTab } from './stores.svelte'

// Nom du dossier parent d'un chemin (séparateurs \ ou /). '' si racine/inconnu.
export function parentFolder(path: string | null): string {
  if (!path) return ''
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : ''
}

// Différenciateur d'un onglet : le dossier parent, uniquement si un autre onglet
// ouvert porte le même nom (FR-4). '' sinon.
export function tabDiscriminator(tab: DocTab, tabs: DocTab[]): string {
  const homonym = tabs.some((t) => t.id !== tab.id && t.name === tab.name)
  return homonym ? parentFolder(tab.path) : ''
}
