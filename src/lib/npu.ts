// Client du sidecar NPU (banc d'essai 17.1) : endpoint OpenAI-compatible streamé
// servi par onnxruntime-genai + EP QNN sur le Hexagon (voir spike/npu-17.1/sidecar).
// But : laisser l'utilisateur BASCULER le copilote sur NPU dans Doku pour comparer
// l'experience à Ollama CPU. Forme livrable finale = bindings Rust (plus tard, si GO).
import type { OpenAiMessage } from './openai'

export const NPU_MODEL = 'qwen2.5-1.5b-npu'
const NPU_BASE = 'http://127.0.0.1:8017/v1'

async function npuStream(
  messages: OpenAiMessage[],
  onToken: (token: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(`${NPU_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ model: NPU_MODEL, messages, stream: true, max_tokens: 512 }),
  })
  if (!res.ok || !res.body) throw new Error(`NPU HTTP ${res.status}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let full = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') return full
        try {
          const piece = JSON.parse(payload)?.choices?.[0]?.delta?.content
          if (piece) {
            full += piece
            onToken(piece)
          }
        } catch {
          // ligne SSE partielle/non-JSON : ignorée
        }
      }
    }
  } catch (e) {
    if (signal.aborted) return full // Stop : on garde le texte partiel (comme chat/openAiChat)
    throw e
  } finally {
    reader.cancel().catch(() => {})
  }
  return full
}

export function npuChat(
  messages: OpenAiMessage[],
  onToken: (token: string) => void,
  signal: AbortSignal,
): Promise<string> {
  return npuStream(messages, onToken, signal)
}

export function npuGenerate(
  prompt: string,
  onToken: (token: string) => void,
  signal: AbortSignal,
): Promise<string> {
  return npuStream([{ role: 'user', content: prompt }], onToken, signal)
}

// Le sidecar tourne-t-il ? (ping non-bloquant, timeout court)
export async function npuAvailable(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1500)
    const r = await fetch(`${NPU_BASE}/models`, { method: 'GET', signal: ctrl.signal })
    clearTimeout(t)
    return r.ok
  } catch {
    return false
  }
}
