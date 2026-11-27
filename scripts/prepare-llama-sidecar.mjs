// Prépare le moteur IA local (ADR-0032) : télécharge la release llama.cpp épinglée pour la cible,
// vérifie son SHA-256, puis copie `llama-server` et ses bibliothèques partagées dans
// src-tauri/binaries/llama/ — dossier livré tel quel en ressource (les DLL doivent rester À CÔTÉ
// de l'exécutable : c'est là que le chargeur Windows les cherche).
// Usage : node scripts/prepare-llama-sidecar.mjs <arm64|x64|linux-x64> [--offline]
import { createHash } from 'node:crypto'
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const BUILD = 'b12810'
const RELEASE_BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${BUILD}`

const TARGETS = {
  arm64: { asset: `llama-${BUILD}-bin-win-cpu-arm64.zip`, sha256: 'b14e4742f5a233e7cccfc4b2766ea06a7c3eaea397b137d4838acb79af1d2b7d', exe: 'llama-server.exe' },
  x64: { asset: `llama-${BUILD}-bin-win-cpu-x64.zip`, sha256: '845e25154ae4051659cf7363908a663cf15f99c57f8d5157d0f38f468acf660d', exe: 'llama-server.exe' },
  'linux-x64': { asset: `llama-${BUILD}-bin-ubuntu-x64.tar.gz`, sha256: '63b94be37dcc34cb4933554d4f998e9649841b23da7ffc71d1f66d63762464d7', exe: 'llama-server' },
}

// Bibliothèques des AUTRES outils de l'archive (bench, perplexity…) : inutiles au serveur.
const isOtherToolLib = (name) => /^llama-(?!server).*-impl\.(dll|so)$/.test(name)
const isSharedLib = (name) => /\.(dll|so)(\.\d+)*$/.test(name)

function assertInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Chemin de travail non sûr : ${candidate}`)
}

async function sha256(file) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), async function* (source) {
    for await (const chunk of source) hash.update(chunk)
  })
  return hash.digest('hex')
}

async function download(url, destination) {
  const partial = `${destination}.partial`
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Doku-build' } })
  if (!response.ok || !response.body) throw new Error(`Téléchargement impossible (${response.status}) : ${url}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
  renameSync(partial, destination)
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      const found = findFile(full, name)
      if (found) return found
    } else if (entry === name) return full
  }
  return null
}

async function main() {
  const [arch, ...flags] = process.argv.slice(2)
  const target = TARGETS[arch]
  if (!target) throw new Error('Cible attendue : arm64, x64 ou linux-x64')
  const offline = flags.includes('--offline')

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const binariesDir = path.join(root, 'src-tauri', 'binaries')
  const cacheDir = path.join(binariesDir, '.cache', `llama-${BUILD}`)
  const stagingDir = path.join(binariesDir, `.staging-${arch}`)
  const outDir = path.join(binariesDir, 'llama')
  mkdirSync(cacheDir, { recursive: true })

  const archive = path.join(cacheDir, target.asset)
  if (existsSync(archive) && (await sha256(archive)) !== target.sha256) rmSync(archive)
  if (!existsSync(archive)) {
    if (offline) throw new Error(`Archive absente du cache : ${archive}`)
    console.log(`Téléchargement de llama.cpp ${BUILD} (${arch})…`)
    await download(`${RELEASE_BASE}/${target.asset}`, archive)
  }
  const actual = await sha256(archive)
  if (actual !== target.sha256) throw new Error(`SHA-256 invalide pour ${target.asset}\nattendu ${target.sha256}\nobtenu  ${actual}`)

  assertInside(binariesDir, stagingDir)
  rmSync(stagingDir, { recursive: true, force: true })
  mkdirSync(stagingDir, { recursive: true })
  // bsdtar (le tar.exe de Windows) lit le zip ; GNU tar (Git Bash) ne le sait pas : lancer
  // depuis PowerShell/cmd sous Windows. Archive passée en nom nu depuis son dossier (GNU tar
  // lirait « G:\… » comme « hôte:chemin »).
  const untar = spawnSync('tar', ['-xf', path.basename(archive), '-C', stagingDir], { cwd: path.dirname(archive), stdio: 'inherit' })
  if (untar.status !== 0) throw new Error(`Extraction impossible (${untar.status ?? 'spawn'})`)

  const exe = findFile(stagingDir, target.exe)
  if (!exe) throw new Error(`${target.exe} absent de ${target.asset}`)
  const sourceDir = path.dirname(exe)
  const files = readdirSync(sourceDir).filter((n) => n === target.exe || n.startsWith('LICENSE') || (isSharedLib(n) && !isOtherToolLib(n)))

  assertInside(binariesDir, outDir)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  for (const name of files) copyFileSync(path.join(sourceDir, name), path.join(outDir, name))

  const serverExe = path.join(outDir, target.exe)
  const env = arch === 'linux-x64' ? { ...process.env, LD_LIBRARY_PATH: outDir } : process.env
  const probe = spawnSync(serverExe, ['--version'], { encoding: 'utf8', env })
  const version = `${probe.stdout ?? ''}\n${probe.stderr ?? ''}`
  // Une cible étrangère à la machine de build (x64 préparé sur ARM64, Linux sur Windows) ne se
  // lance pas forcément : on ne sonde que si le binaire a pu démarrer.
  if (probe.status === 0 && !version.includes(BUILD.slice(1))) throw new Error(`llama-server ne répond pas comme le build ${BUILD} :\n${version}`)

  writeFileSync(
    path.join(binariesDir, '.prepared.json'),
    `${JSON.stringify({ engine: 'llama.cpp', build: BUILD, target: arch, sourceAsset: target.asset, sourceSha256: target.sha256, files }, null, 2)}\n`,
    'utf8',
  )
  rmSync(stagingDir, { recursive: true, force: true })
  console.log(`llama.cpp ${BUILD} ${arch} préparé : ${files.length} fichiers dans src-tauri/binaries/llama/.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
