import { baseName } from './explorer'
import { parseWorkspacePathSnapshot, type WorkspacePathSnapshot } from './session'
import type { CopilotProvider } from './stores.svelte'

export const CONVERSATION_VERSION = 1
export const MAX_PERSISTED_INLINE_CHARS = 8 * 1024
export const MAX_PERSISTED_EVIDENCE_CHARS = 2 * 1024
export const MAX_PERSISTED_EVIDENCE_PER_MESSAGE = 32 * 1024
export const MAX_PERSISTED_CONTEXT_CHARS = 512 * 1024
export const MAX_CONVERSATION_FILES = 1_000
export const MAX_CONVERSATION_SEARCH_CHARS = 50 * 1024 * 1024

export type PersistedContextItem =
  | { kind: 'file'; id: string; path: string; label: string; signature: string | null }
  | { kind: 'selection' | 'clipboard'; id: string; label: string; text: string; truncated: boolean }

export interface PersistedEvidence {
  kind: 'document' | 'web' | 'memory' | 'context'
  locator: string
  label: string
  snippet: string
  hash: string | null
}

export interface PersistedActivity {
  id: string
  kind: 'context' | 'memory' | 'web-plan' | 'web-search' | 'answer'
  label: string
  detail?: string
  state: 'done' | 'error'
}

export interface PersistedChatMessage {
  role: 'user' | 'assistant'
  content: string
  terminal?: 'complete' | 'interrupted' | 'failed' | 'notice'
  sourceLabel?: string
  evidence?: PersistedEvidence[]
  activity?: PersistedActivity[]
  citedOnly?: boolean
  cited?: number[]
  webSearch?: boolean
}

export interface ConversationV1 {
  version: 1
  id: string
  revision: number
  title: string
  titlePinned: boolean
  createdAt: string
  updatedAt: string
  archived: boolean
  messages: PersistedChatMessage[]
  contextItems: PersistedContextItem[]
  scope: 'doc' | 'folder'
  contextFolder: { path: string; label: string } | null
  memoryFolder: { path: string; label: string } | null
  webSearchEnabled: boolean
  lastProvider: CopilotProvider
  workspace: WorkspacePathSnapshot
}

export interface ConversationSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  documentNames: string[]
  preview: string
  messageCount: number
  archived: boolean
}

export interface ConversationGroup {
  key: 'today' | 'week' | 'older'
  label: string
  conversations: ConversationSummary[]
}

export interface ConversationSearchResult {
  summary: ConversationSummary
  match: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROVIDERS = new Set<CopilotProvider>(['ollama', 'openai', 'minimax'])
const ACTIVITY_KINDS = new Set<PersistedActivity['kind']>(['context', 'memory', 'web-plan', 'web-search', 'answer'])

function string(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\u0000/g, '').slice(0, max) : ''
}

function inline(value: unknown, max = 160): string {
  return string(value, max * 2).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max)
}

function iso(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return fallback
  return new Date(value).toISOString()
}

function hash(value: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

function pathFolder(value: unknown): { path: string; label: string } | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const path = string(record.path, 4_096).trim()
  if (!path) return null
  return { path, label: inline(record.label, 120) || baseName(path) || 'Dossier' }
}

function parseActivity(value: unknown): PersistedActivity | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const kind = ACTIVITY_KINDS.has(record.kind as PersistedActivity['kind'])
    ? record.kind as PersistedActivity['kind']
    : null
  if (!kind) return null
  return {
    id: inline(record.id, 120) || `${kind}:${hash(JSON.stringify(record))}`,
    kind,
    label: inline(record.label, 180) || 'Activité',
    detail: inline(record.detail, 300) || undefined,
    state: record.state === 'error' ? 'error' : 'done',
  }
}

function safeHttps(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function parseEvidence(value: unknown): PersistedEvidence | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const kind = record.kind === 'web' || record.kind === 'memory' || record.kind === 'context'
    ? record.kind
    : 'document'
  let locator = string(record.locator, 4_096).trim()
  if (kind === 'web') locator = safeHttps(locator) ?? ''
  if (!locator && kind !== 'context') return null
  const snippet = string(record.snippet, MAX_PERSISTED_EVIDENCE_CHARS)
  return {
    kind,
    locator,
    label: inline(record.label, 160) || (kind === 'web' ? 'Source Web' : 'Source'),
    snippet,
    hash: inline(record.hash, 80) || (snippet ? hash(snippet) : null),
  }
}

function parseMessage(value: unknown): PersistedChatMessage | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.role !== 'user' && record.role !== 'assistant') return null
  const content = string(record.content, 1_000_000)
  if (!content && record.role === 'user') return null
  const evidence: PersistedEvidence[] = []
  let evidenceChars = 0
  if (Array.isArray(record.evidence)) {
    for (const candidate of record.evidence) {
      const item = parseEvidence(candidate)
      if (!item || evidenceChars + item.snippet.length > MAX_PERSISTED_EVIDENCE_PER_MESSAGE) continue
      evidence.push(item)
      evidenceChars += item.snippet.length
      if (evidence.length >= 32) break
    }
  }
  const terminal = record.terminal === 'interrupted' || record.terminal === 'failed' || record.terminal === 'notice'
    ? record.terminal
    : 'complete'
  return {
    role: record.role,
    content,
    terminal,
    sourceLabel: inline(record.sourceLabel, 160) || undefined,
    evidence: evidence.length ? evidence : undefined,
    activity: Array.isArray(record.activity)
      ? record.activity.map(parseActivity).filter((x): x is PersistedActivity => x !== null).slice(0, 32)
      : undefined,
    citedOnly: record.citedOnly === true || undefined,
    cited: Array.isArray(record.cited)
      ? [...new Set(record.cited.filter((x): x is number => Number.isInteger(x) && x > 0 && x <= 99))].slice(0, 32)
      : undefined,
    webSearch: record.webSearch === true || undefined,
  }
}

function parseContextItems(value: unknown): PersistedContextItem[] {
  if (!Array.isArray(value)) return []
  const out: PersistedContextItem[] = []
  let total = 0
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const record = candidate as Record<string, unknown>
    const id = inline(record.id, 240)
    const label = inline(record.label, 120) || 'Contexte'
    if (!id) continue
    if (record.kind === 'file') {
      const path = string(record.path, 4_096).trim()
      if (!path) continue
      out.push({ kind: 'file', id, path, label, signature: inline(record.signature, 160) || null })
    } else if (record.kind === 'selection' || record.kind === 'clipboard') {
      const raw = string(record.text, MAX_PERSISTED_INLINE_CHARS + 1)
      const text = raw.slice(0, MAX_PERSISTED_INLINE_CHARS)
      if (!text || total + text.length > MAX_PERSISTED_CONTEXT_CHARS) continue
      total += text.length
      out.push({ kind: record.kind, id, label, text, truncated: record.truncated === true || raw.length > text.length })
    }
    if (out.length >= 8) break
  }
  return out
}

export function parseConversation(raw: string): ConversationV1 | null {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.version !== CONVERSATION_VERSION || typeof record.id !== 'string' || !UUID.test(record.id)) return null
  const now = new Date().toISOString()
  const createdAt = iso(record.createdAt, now)
  const messages = Array.isArray(record.messages)
    ? record.messages.map(parseMessage).filter((x): x is PersistedChatMessage => x !== null)
    : []
  return {
    version: 1,
    id: record.id,
    revision: typeof record.revision === 'number' && Number.isInteger(record.revision) && record.revision >= 0 ? record.revision : 0,
    title: inline(record.title, 120) || titleFromMessages(messages),
    titlePinned: record.titlePinned === true,
    createdAt,
    updatedAt: iso(record.updatedAt, createdAt),
    archived: record.archived === true,
    messages,
    contextItems: parseContextItems(record.contextItems),
    scope: record.scope === 'folder' ? 'folder' : 'doc',
    contextFolder: pathFolder(record.contextFolder),
    memoryFolder: pathFolder(record.memoryFolder),
    webSearchEnabled: record.webSearchEnabled === true,
    lastProvider: PROVIDERS.has(record.lastProvider as CopilotProvider) ? record.lastProvider as CopilotProvider : 'ollama',
    workspace: parseWorkspacePathSnapshot(record.workspace),
  }
}

export function serializeConversation(value: ConversationV1): string {
  const parsed = parseConversation(JSON.stringify(value))
  if (!parsed) throw new Error('Discussion invalide.')
  return JSON.stringify(parsed, null, 2)
}

export function createConversationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? '00000000-0000-4000-8000-000000000000'.replace(/0/g, () => Math.floor(Math.random() * 16).toString(16))
}

export function titleFromMessages(messages: readonly Pick<PersistedChatMessage, 'role' | 'content'>[]): string {
  const question = messages.find((message) => message.role === 'user')?.content ?? ''
  const clean = inline(question, 84)
  return clean || 'Nouvelle discussion'
}

export function summarizeConversation(value: ConversationV1): ConversationSummary {
  const documentNames = [value.workspace.primaryPath, value.workspace.secondaryPath]
    .filter((path): path is string => Boolean(path))
    .map((path) => baseName(path))
  const preview = inline([...value.messages].reverse().find((message) => message.content.trim())?.content, 160)
  return {
    id: value.id,
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    documentNames: [...new Set(documentNames)],
    preview,
    messageCount: value.messages.length,
    archived: value.archived,
  }
}

export function groupConversations(items: readonly ConversationSummary[], now = new Date()): ConversationGroup[] {
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const weekAgo = startToday - 6 * 86_400_000
  const groups: ConversationGroup[] = [
    { key: 'today', label: 'Aujourd’hui', conversations: [] },
    { key: 'week', label: '7 derniers jours', conversations: [] },
    { key: 'older', label: 'Plus anciennes', conversations: [] },
  ]
  for (const item of [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))) {
    const timestamp = Date.parse(item.updatedAt)
    const target = timestamp >= startToday ? groups[0] : timestamp >= weekAgo ? groups[1] : groups[2]
    target.conversations.push(item)
  }
  return groups.filter((group) => group.conversations.length > 0)
}

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr-BE')
}

export function searchConversations(records: readonly ConversationV1[], query: string): ConversationSearchResult[] {
  const q = normalizeSearch(query.trim())
  if (!q) return records.map((record) => ({ summary: summarizeConversation(record), match: '' }))
  return records.flatMap((record) => {
    const summary = summarizeConversation(record)
    const candidates = [summary.title, ...summary.documentNames, ...record.messages.map((message) => message.content)]
    const match = candidates.find((candidate) => normalizeSearch(candidate).includes(q))
    return match ? [{ summary, match: inline(match, 180) }] : []
  }).sort((a, b) => Date.parse(b.summary.updatedAt) - Date.parse(a.summary.updatedAt))
}

const PROVIDER_CONTEXT_CHARS: Record<CopilotProvider, number> = {
  ollama: 48_000,
  minimax: 240_000,
  openai: 420_000,
}

export function historyBudget(provider: CopilotProvider, fixedChars: number): number {
  const total = PROVIDER_CONTEXT_CHARS[provider]
  const outputReserve = provider === 'ollama' ? 12_000 : 32_000
  return Math.max(0, total - Math.max(0, fixedChars) - outputReserve)
}

export function conversationHistoryWindow(
  messages: readonly Pick<PersistedChatMessage, 'role' | 'content' | 'terminal'>[],
  maxChars: number,
): { messages: PersistedChatMessage[]; omitted: number } {
  const pairs: PersistedChatMessage[][] = []
  for (let index = 0; index < messages.length - 1; index++) {
    const user = messages[index]
    const assistant = messages[index + 1]
    if (user.role !== 'user' || assistant.role !== 'assistant' || assistant.terminal === 'failed' || assistant.terminal === 'notice' || assistant.terminal === 'interrupted') continue
    pairs.push([
      { role: 'user', content: user.content, terminal: user.terminal ?? 'complete' },
      { role: 'assistant', content: assistant.content, terminal: assistant.terminal ?? 'complete' },
    ])
    index++
  }
  const selected: PersistedChatMessage[][] = []
  let used = 0
  for (let index = pairs.length - 1; index >= 0; index--) {
    const size = pairs[index].reduce((sum, message) => sum + message.content.length, 0)
    if (used + size > maxChars) break
    selected.unshift(pairs[index])
    used += size
  }
  return { messages: selected.flat(), omitted: (pairs.length - selected.length) * 2 }
}
