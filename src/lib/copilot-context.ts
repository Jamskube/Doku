export const MAX_CONTEXT_ITEMS = 8
export const MAX_CONTEXT_TEXT_BYTES = 2 * 1024 * 1024
export const MAX_CONTEXT_PDF_BYTES = 25 * 1024 * 1024
export const MAX_CONTEXT_ITEM_CHARS = 240_000
export const MAX_CONTEXT_LOAD_CONCURRENCY = 2

export type CopilotContextKind = 'selection' | 'clipboard' | 'file'

export interface CopilotContextItem {
  id: string
  kind: CopilotContextKind
  label: string
  text: string
  charCount: number
  path?: string | null
  signature?: string
  truncatedAtLoad: boolean
}

export interface ContextSourceInput {
  id: string
  kind: 'document' | 'rag' | CopilotContextKind
  label: string
  text: string
  path?: string | null
}

export interface SentContextSource {
  id: string
  kind: ContextSourceInput['kind']
  label: string
  originalChars: number
  sentChars: number
  truncatedAtLoad: boolean
  truncatedForRequest: boolean
  primary: boolean
}

export interface PackedContextSource extends SentContextSource {
  text: string
  path?: string | null
}

export interface ContextBundle {
  primary: PackedContextSource[]
  additions: PackedContextSource[]
  sentSources: SentContextSource[]
  maxChars: number
  fingerprint: string
  truncatedForRequest: boolean
}

export function normalizeContextPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '').toLocaleLowerCase('en-US')
}

export function pathBelongsToFolder(path: string | null | undefined, folder: string | null | undefined): boolean {
  if (!path || !folder) return false
  const normalizedPath = normalizeContextPath(path)
  const normalizedFolder = normalizeContextPath(folder)
  return normalizedPath.startsWith(`${normalizedFolder}/`)
}

function hashText(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function contextItemId(p: {
  kind: CopilotContextKind
  path?: string | null
  owner?: string | null
  from?: number
  to?: number
  text: string
}): string {
  if (p.kind === 'file' && p.path) return `file:${normalizeContextPath(p.path)}`
  const anchor = p.kind === 'selection' ? `${normalizeContextPath(p.owner ?? '')}:${p.from ?? 0}:${p.to ?? 0}:` : ''
  return `${p.kind}:${anchor}${hashText(p.text)}`
}

export function cleanContextLabel(label: string, fallback = 'Contexte'): string {
  const base = label.split(/[\\/]/).pop()?.replace(/[\r\n\t]+/g, ' ').replace(/["«»]/g, '').trim() ?? ''
  return (base || fallback).slice(0, 120)
}

export function truncateContextItem(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_CONTEXT_ITEM_CHARS) return { text, truncated: false }
  return { text: text.slice(0, MAX_CONTEXT_ITEM_CHARS), truncated: true }
}

export function upsertContextItems(
  items: readonly CopilotContextItem[],
  incoming: readonly CopilotContextItem[],
): { items: CopilotContextItem[]; rejected: number } {
  const out = [...items]
  let rejected = 0
  for (const item of incoming) {
    const existing = out.findIndex((x) => x.id === item.id)
    if (existing >= 0) out[existing] = item
    else if (out.length < MAX_CONTEXT_ITEMS) out.push(item)
    else rejected++
  }
  return { items: out, rejected }
}

function allocate(total: number, lengths: readonly number[]): number[] {
  const out = lengths.map(() => 0)
  let left = Math.max(0, total)
  let active = lengths.map((length, index) => ({ length, index }))
  while (left > 0 && active.length > 0) {
    const share = Math.max(1, Math.floor(left / active.length))
    const next: typeof active = []
    let spent = 0
    for (const entry of active) {
      const need = entry.length - out[entry.index]
      const available = left - spent
      if (available <= 0) {
        next.push(entry)
        continue
      }
      const take = Math.min(need, share, available)
      out[entry.index] += take
      spent += take
      if (take < need) next.push(entry)
    }
    if (spent === 0) break
    left -= spent
    active = next
  }
  return out
}

function groupBudget(total: number, primaryChars: number, additionChars: number): [number, number] {
  if (primaryChars === 0) return [0, Math.min(total, additionChars)]
  if (additionChars === 0) return [Math.min(total, primaryChars), 0]
  const half = Math.floor(total / 2)
  let primary = Math.min(primaryChars, half)
  let additions = Math.min(additionChars, total - primary)
  const remaining = total - primary - additions
  if (remaining > 0) {
    const primaryNeed = primaryChars - primary
    const toPrimary = Math.min(remaining, primaryNeed)
    primary += toPrimary
    additions += Math.min(remaining - toPrimary, additionChars - additions)
  }
  return [primary, additions]
}

function packGroup(inputs: readonly ContextSourceInput[], budget: number, primary: boolean): PackedContextSource[] {
  const allocations = allocate(budget, inputs.map((x) => x.text.length))
  return inputs.flatMap((source, index) => {
    const sentChars = allocations[index]
    if (sentChars <= 0) return []
    return [{
      ...source,
      text: source.text.slice(0, sentChars),
      originalChars: source.text.length,
      sentChars,
      truncatedAtLoad: false,
      truncatedForRequest: sentChars < source.text.length,
      primary,
    }]
  })
}

export function buildContextBundle(p: {
  primary: readonly ContextSourceInput[]
  additions: readonly CopilotContextItem[]
  maxChars: number
}): ContextBundle {
  const primaryChars = p.primary.reduce((sum, x) => sum + x.text.length, 0)
  const additionInputs: ContextSourceInput[] = p.additions.map((x) => ({
    id: x.id,
    kind: x.kind,
    label: cleanContextLabel(x.label),
    text: x.text,
  }))
  const additionChars = additionInputs.reduce((sum, x) => sum + x.text.length, 0)
  const [primaryBudget, additionBudget] = groupBudget(Math.max(0, p.maxChars), primaryChars, additionChars)
  const primary = packGroup(p.primary, primaryBudget, true)
  const additions = packGroup(additionInputs, additionBudget, false).map((source) => {
    const item = p.additions.find((x) => x.id === source.id)
    return { ...source, truncatedAtLoad: item?.truncatedAtLoad ?? false }
  })
  const all = [...primary, ...additions]
  const sentSources = all.map(({ text: _text, path: _path, ...source }) => source)
  return {
    primary,
    additions,
    sentSources,
    maxChars: p.maxChars,
    fingerprint: hashText(all.map((x) => `${x.id}:${x.text}`).join('\n')),
    truncatedForRequest: all.some((x) => x.truncatedForRequest),
  }
}
