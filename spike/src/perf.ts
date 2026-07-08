export const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r))

// Insère `chars` caractères un par frame et mesure les écarts entre frames :
// avg ≈ coût par frappe, max = pire gel perçu.
export async function measureTyping(insert: (ch: string) => void, chars = 80) {
  await nextFrame()
  const gaps: number[] = []
  let last = performance.now()
  for (let i = 0; i < chars; i++) {
    insert('abcdefghij '[i % 11])
    await nextFrame()
    const now = performance.now()
    gaps.push(now - last)
    last = now
  }
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
  const sorted = [...gaps].sort((a, b) => a - b)
  return {
    avgMs: +avg.toFixed(1),
    p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
    maxMs: +Math.max(...gaps).toFixed(1),
  }
}

export function makeLogger(el: HTMLElement) {
  return (msg: string) => {
    el.textContent += '\n' + msg
    el.scrollTop = el.scrollHeight
    console.log(msg)
  }
}
