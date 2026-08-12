import { createHash } from 'node:crypto'
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const OLLAMA_VERSION = '0.32.0'
const RELEASE_BASE = `https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}`

const COMMON_CPU_FILES = [
  'ggml-base.dll',
  'ggml.dll',
  'libc++.dll',
  'libllama-common.dll',
  'libllama-quantize-impl.dll',
  'libllama-server-impl.dll',
  'libllama.dll',
  'libmtmd.dll',
  'libunwind.dll',
  'libwinpthread-1.dll',
  'llama-quantize.exe',
  'llama-server.exe',
]

const TARGETS = {
  arm64: {
    triple: 'aarch64-pc-windows-msvc',
    asset: 'ollama-windows-arm64.zip',
    sha256: '82b7d36b63e62a44d3f9853c2f8edb829cf871eaf722ce20070e09e96922c0cc',
    cpuFiles: [...COMMON_CPU_FILES, 'ggml-cpu.dll'],
  },
  x64: {
    triple: 'x86_64-pc-windows-msvc',
    asset: 'ollama-windows-amd64.zip',
    sha256: '56561a8f0a904483303c610e61af61c5a7b6f5496ce3707e207d25d4ff67b89e',
    cpuFiles: [
      ...COMMON_CPU_FILES,
      'libomp.dll',
      'ggml-cpu-alderlake.dll',
      'ggml-cpu-cannonlake.dll',
      'ggml-cpu-cascadelake.dll',
      'ggml-cpu-cooperlake.dll',
      'ggml-cpu-haswell.dll',
      'ggml-cpu-icelake.dll',
      'ggml-cpu-ivybridge.dll',
      'ggml-cpu-piledriver.dll',
      'ggml-cpu-sandybridge.dll',
      'ggml-cpu-sapphirerapids.dll',
      'ggml-cpu-skylakex.dll',
      'ggml-cpu-sse42.dll',
      'ggml-cpu-x64.dll',
      'ggml-cpu-zen4.dll',
    ],
  },
}

function parseArgs(argv) {
  const [arch, ...rest] = argv
  const options = { arch, exe: null, lib: null, offline: false }
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--offline') options.offline = true
    else if (rest[i] === '--exe') options.exe = rest[++i]
    else if (rest[i] === '--lib') options.lib = rest[++i]
    else throw new Error(`Argument inconnu : ${rest[i]}`)
  }
  if (!TARGETS[arch]) throw new Error('Architecture attendue : arm64 ou x64')
  if (Boolean(options.exe) !== Boolean(options.lib)) {
    throw new Error('--exe et --lib doivent être fournis ensemble')
  }
  return options
}

function assertInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Chemin de travail non sûr : ${candidate}`)
  }
}

async function sha256(file) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('end', resolve).on('error', reject)
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

function extractCpuPayload(archive, stagingDir, cpuFiles) {
  const members = ['ollama.exe', ...cpuFiles.map((name) => `lib/ollama/${name}`)]
  const result = spawnSync('tar', ['-xf', archive, '-C', stagingDir, ...members], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Extraction sélective impossible (${result.status ?? 'spawn'})`)
  return {
    exe: path.join(stagingDir, 'ollama.exe'),
    lib: path.join(stagingDir, 'lib', 'ollama'),
  }
}

function verifyPayload(exe, lib, cpuFiles) {
  const missing = []
  if (!existsSync(exe)) missing.push(exe)
  for (const name of cpuFiles) {
    const candidate = path.join(lib, name)
    if (!existsSync(candidate)) missing.push(candidate)
  }
  if (missing.length) throw new Error(`Payload Ollama incomplet :\n${missing.join('\n')}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const target = TARGETS[options.arch]
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(scriptDir, '..')
  const binariesDir = path.join(projectRoot, 'src-tauri', 'binaries')
  const cacheDir = path.join(binariesDir, '.cache', `ollama-v${OLLAMA_VERSION}`)
  const stagingDir = path.join(binariesDir, `.staging-${options.arch}`)
  const targetExe = path.join(binariesDir, `ollama-${target.triple}.exe`)
  const targetLib = path.join(binariesDir, 'lib', 'ollama')

  mkdirSync(cacheDir, { recursive: true })
  let sourceExe
  let sourceLib

  if (options.exe) {
    sourceExe = path.resolve(options.exe)
    sourceLib = path.resolve(options.lib)
  } else {
    const archive = path.join(cacheDir, target.asset)
    if (existsSync(archive) && (await sha256(archive)) !== target.sha256) {
      assertInside(cacheDir, archive)
      rmSync(archive)
    }
    if (!existsSync(archive)) {
      if (options.offline) throw new Error(`Archive absente du cache : ${archive}`)
      console.log(`Téléchargement d'Ollama ${OLLAMA_VERSION} ${options.arch}…`)
      await download(`${RELEASE_BASE}/${target.asset}`, archive)
    }
    const actualHash = await sha256(archive)
    if (actualHash !== target.sha256) {
      throw new Error(`SHA-256 invalide pour ${target.asset}\nattendu ${target.sha256}\nobtenu  ${actualHash}`)
    }
    assertInside(binariesDir, stagingDir)
    rmSync(stagingDir, { recursive: true, force: true })
    mkdirSync(stagingDir, { recursive: true })
    const extracted = extractCpuPayload(archive, stagingDir, target.cpuFiles)
    sourceExe = extracted.exe
    sourceLib = extracted.lib
  }

  verifyPayload(sourceExe, sourceLib, target.cpuFiles)
  assertInside(binariesDir, targetExe)
  assertInside(binariesDir, targetLib)
  rmSync(targetExe, { force: true })
  rmSync(targetLib, { recursive: true, force: true })
  mkdirSync(targetLib, { recursive: true })
  copyFileSync(sourceExe, targetExe)
  for (const name of target.cpuFiles) copyFileSync(path.join(sourceLib, name), path.join(targetLib, name))
  verifyPayload(targetExe, targetLib, target.cpuFiles)

  const versionProbe = spawnSync(targetExe, ['--version'], { encoding: 'utf8' })
  const versionOutput = `${versionProbe.stdout ?? ''}\n${versionProbe.stderr ?? ''}`.trim()
  if (versionProbe.status !== 0 || !versionOutput.includes(OLLAMA_VERSION)) {
    throw new Error(`Le sidecar préparé ne répond pas comme Ollama ${OLLAMA_VERSION} :\n${versionOutput}`)
  }

  const manifest = {
    version: OLLAMA_VERSION,
    architecture: options.arch,
    targetTriple: target.triple,
    sourceAsset: target.asset,
    sourceSha256: target.sha256,
    sidecarSha256: await sha256(targetExe),
    cpuFiles: target.cpuFiles,
  }
  writeFileSync(path.join(binariesDir, '.prepared.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  if (existsSync(stagingDir)) {
    assertInside(binariesDir, stagingDir)
    rmSync(stagingDir, { recursive: true, force: true })
  }
  console.log(`Ollama ${OLLAMA_VERSION} ${options.arch} préparé (${target.cpuFiles.length} fichiers CPU).`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
