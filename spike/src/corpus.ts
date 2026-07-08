const raw = import.meta.glob('../corpus/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export const corpus: Record<string, string> = Object.fromEntries(
  Object.entries(raw).map(([path, content]) => [path.split('/').pop()!, content]),
)

export const corpusFiles = Object.keys(corpus).filter((n) => !n.startsWith('09-')).sort()
export const stressFile = '09-stress-500k.md'
