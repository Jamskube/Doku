import type { Printable } from './print'
import { IMAGE } from './render-md'
import { collectLocalImages } from './standalone'
import { resolveLocalImagePath } from '../images'

export interface PortableMarkdownIO {
  readImageDataUrl: (absPath: string) => Promise<string | null>
  save: (defaultName: string, markdown: string) => Promise<boolean>
}

export interface PortableMarkdownResult {
  status: 'saved' | 'cancelled'
  inlined: number
  missing: string[]
}

export function portableMarkdownName(name: string): string {
  // Ré-exporter une copie portable ne doit pas donner `x-portable-portable.md`.
  return name.replace(/\.[^.\\/]+$/, '').replace(/-portable$/, '') + '-portable.md'
}

// Le Markdown est un texte que l'utilisateur a pu recevoir : `![x](../../.ssh/id_rsa)` ou
// un chemin absolu ferait embarquer n'importe quel fichier du disque dans la copie. Seules
// les images SOUS le dossier du document sont intégrées ; les autres restent liées.
export function isInsideDir(absPath: string, dir: string): boolean {
  if (!dir) return false
  // Un seul séparateur canonique : le dossier vient de Tauri en `\`, une URL absolue du
  // Markdown peut être en `/` — les deux désignent le même endroit sous Windows.
  const norm = (p: string) => {
    const out: string[] = []
    for (const seg of p.split(/[\\/]+/)) {
      if (seg === '..') out.pop()
      else if (seg && seg !== '.') out.push(seg)
    }
    return out.join('/').toLowerCase()
  }
  return norm(absPath).startsWith(norm(dir) + '/')
}

export function inlineMarkdownImages(markdown: string, images: Map<string, string>): string {
  return markdown.replace(IMAGE, (match, pre: string, url: string, post: string) => {
    const data = images.get(url.trim())
    return data ? `${pre}${data}${post}` : match
  })
}

export async function exportPortableMarkdown(
  tab: Printable,
  io: PortableMarkdownIO,
): Promise<PortableMarkdownResult> {
  const images = new Map<string, string>()
  const missing: string[] = []
  for (const url of collectLocalImages(tab)) {
    const abs = resolveLocalImagePath(url, tab.dir ?? '')
    const data = isInsideDir(abs, tab.dir ?? '') ? await io.readImageDataUrl(abs) : null
    if (data) images.set(url, data)
    else missing.push(url)
  }
  const saved = await io.save(portableMarkdownName(tab.name), inlineMarkdownImages(tab.content, images))
  return { status: saved ? 'saved' : 'cancelled', inlined: images.size, missing }
}
