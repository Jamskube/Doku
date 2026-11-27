// Nom court d'un modèle pour la capsule du composeur : le dernier segment d'un chemin
// (« hf.co/LiquidAI/LFM2-2.6B-GGUF:Q4_0 » → « LFM2-2.6B »), sans les suffixes techniques de
// quantification ni de variante. Le nom complet reste dans le nom accessible et la bulle.
export function shortModelName(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const [family, tag = ''] = base.split(':')
  const size = tag.replace(/-(instruct|chat|it)\b.*$/i, '').replace(/-q\d.*$/i, '')
  const head = family.replace(/-gguf$/i, '')
  return size && !/^(latest|q\d)/i.test(size) ? `${head} ${size}` : head
}
