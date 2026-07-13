// Renderer Markdown → HTML pour l'export (story 10.2, ADR-0009). L'app n'a pas de
// rendu HTML du markdown (la live-preview décore du brut) ; l'export en a besoin.
// Choix : `marked` (GFM par défaut, ~12 Ko, zéro-dép) + `sanitizeHtml` (DOMPurify).
//
// Deux pré-passes AVANT marked (plutôt qu'un renderer custom, dont l'API bouge selon
// les versions de marked) :
//   - wikilinks `[[cible]]` → texte brut (hors grammaire markdown ; inertes en PDF).
//   - URLs d'images résolues (asset:// natif) — même logique que live-preview::imageSrc.
// La sortie brute de marked (raw HTML inclus) est ensuite assainie par DOMPurify, puis
// destinée à un iframe sandboxé + CSP `default-src 'none'` (défense en profondeur).
import { marked } from 'marked'
import { sanitizeHtml } from '../sanitize'
import { isBlockedImageUrl, resolveLocalImagePath } from '../images'
import { convertFileSrc } from '@tauri-apps/api/core'
import { isTauri } from '../tauri'

const WIKILINK = /\[\[([^[\]\n]+)\]\]/g
// ![alt](url) ou ![alt](url "titre") — url = jusqu'au premier espace/paren (groupe 2).
// Exporté pour que l'export autonome (standalone.ts) collecte les mêmes URLs que le rendu
// (source unique — évite une divergence silencieuse « collectée mais non résolue »).
export const IMAGE = /(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g

export type ImageResolver = (url: string, dir: string) => string | null

// Résolveur par défaut (export PDF) : bloquée (réseau/UNC) → null → image SUPPRIMÉE
// (neutralisée à la source, pas via la CSP seule) ; data: telle quelle ; locale résolue
// au dossier puis asset:// en natif. Le standalone (10.3) injecte son propre résolveur (data:).
function assetResolveImage(url: string, dir: string): string | null {
  const u = url.trim()
  if (isBlockedImageUrl(u)) return null
  if (/^data:/i.test(u)) return u
  const abs = resolveLocalImagePath(u, dir)
  return isTauri ? convertFileSrc(abs) : abs
}

// Échappe les caractères markdown actifs — la cible d'un wikilink reste du texte inerte
// après re-parse par marked (sinon `[[**x**]]` deviendrait du gras).
function escapeMarkdown(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!~|>]/g, '\\$&')
}

// NB : pré-passes appliquées à tout le source, code compris (fences/inline) — un bloc
// documentant ces syntaxes serait réécrit. Limite connue (passe token-aware = ultérieur).
function preprocess(md: string, dir: string, resolve: ImageResolver): string {
  return md
    .replace(WIKILINK, (_m, target: string) => escapeMarkdown(target))
    .replace(IMAGE, (_m, pre: string, url: string, post: string) => {
      const src = resolve(url, dir)
      return src === null ? '' : `${pre}${src}${post}`
    })
}

// Rend un document Markdown en HTML assaini (document complet, prêt pour injectHead).
// `dir` = dossier du fichier (résolution des images relatives) ; `resolveImage` permet
// à l'export autonome (10.3) d'injecter des data: URIs au lieu d'asset://.
export function renderMarkdown(md: string, opts: { dir?: string; resolveImage?: ImageResolver } = {}): string {
  const resolve = opts.resolveImage ?? assetResolveImage
  const pre = preprocess(md, opts.dir ?? '', resolve)
  const html = marked.parse(pre, { gfm: true, async: false }) as string
  return sanitizeHtml(html)
}
