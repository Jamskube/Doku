// Piège à proxy : tout process lancé avec HTTP(S)_PROXY=http://127.0.0.1:8098 qui tente
// une sortie réseau via son client HTTP vient frapper ici ; chaque tentative est journalisée.
import { createServer } from 'node:net'
import { appendFileSync } from 'node:fs'
const log = process.argv[2]
createServer((s) => s.once('data', (b) => {
  appendFileSync(log, `${new Date().toISOString()} ${b.toString().split('\r\n')[0]}\n`)
  s.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
})).listen(8098, '127.0.0.1', () => appendFileSync(log, `${new Date().toISOString()} TRAP READY\n`))
