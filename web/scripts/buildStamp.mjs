// Writes dist/build-stamp.json after a production build (03 section 7.1). The backend compares the stamp with the
// sources at start-up and in /api/health (backend/nq_terminal/desktop/build_stamp.py) and reports the page build as
// `current`, `stale` or `missing`, so a pull that changes a source or the API contract never serves an old page.
//
//   {"v": 1, "newest_source_mtime_ms": <whole milliseconds>, "openapi_sha256": "<64 hex>"}
//
// The source list is the one start.ps1 checks (Get-NewestSourceTime): every file under src except *.test.* and
// *.gallery.*, a few top-level files, and everything under public. The launch page session.html is a build input too.
// The hash is the full sha256 of contract/openapi.json; no shortened form is used anywhere.
// Usage: node scripts/buildStamp.mjs [--web <web dir>] [<dist dir> [<openapi.json>]]
//   defaults: this web folder, web/dist and ../contract/openapi.json
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const STAMP_NAME = 'build-stamp.json'
export const STAMP_VERSION = 1
export const TOP_LEVEL_SOURCES = ['index.html', 'session.html', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json']
const NOT_A_SOURCE = /\.(test|gallery)\./
const NS_PER_MS = 1_000_000n

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OPENAPI = path.resolve(WEB_DIR, '..', 'contract', 'openapi.json')

function filesUnder(folder) {
  if (!existsSync(folder) || !statSync(folder).isDirectory()) return []
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name)
    if (entry.isDirectory()) return filesUnder(full)
    return entry.isFile() ? [full] : []
  })
}

/** The files whose modification times decide whether `dist` is current. */
export function sourceFiles(webDir = WEB_DIR) {
  const files = filesUnder(path.join(webDir, 'src')).filter((file) => !NOT_A_SOURCE.test(path.basename(file)))
  for (const name of TOP_LEVEL_SOURCES) {
    const file = path.join(webDir, name)
    if (existsSync(file) && statSync(file).isFile()) files.push(file)
  }
  return files.concat(filesUnder(path.join(webDir, 'public')))
}

/** The newest modification time of the source list in whole milliseconds since the epoch (0 when there is none). */
export function newestSourceMtimeMs(webDir = WEB_DIR) {
  let newest = 0n
  for (const file of sourceFiles(webDir)) {
    const ms = statSync(file, { bigint: true }).mtimeNs / NS_PER_MS
    if (ms > newest) newest = ms
  }
  return Number(newest)
}

/** The full sha256 of the API contract file, in 64 lowercase hex characters. */
export function openapiSha256(contract = DEFAULT_OPENAPI) {
  return createHash('sha256').update(readFileSync(contract)).digest('hex')
}

export function makeStamp(webDir = WEB_DIR, contract = DEFAULT_OPENAPI) {
  return {
    v: STAMP_VERSION,
    newest_source_mtime_ms: newestSourceMtimeMs(webDir),
    openapi_sha256: openapiSha256(contract),
  }
}

/** Writes `<dist>/build-stamp.json` (LF, one line) and returns its path. A missing dist folder is an error. */
export function writeStamp({ webDir = WEB_DIR, distDir = path.join(WEB_DIR, 'dist'), contract = DEFAULT_OPENAPI } = {}) {
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) throw new Error(`no build folder at ${distDir}; run the build first`)
  const file = path.join(distDir, STAMP_NAME)
  writeFileSync(file, `${JSON.stringify(makeStamp(webDir, contract))}\n`, { encoding: 'utf8' })
  return file
}

function main(argv) {
  const rest = [...argv]
  const flag = rest.indexOf('--web')
  const webArg = flag === -1 ? undefined : rest.splice(flag, 2)[1]
  if (flag !== -1 && webArg === undefined) throw new Error('--web needs a folder')
  const [distArg, contractArg] = rest
  const file = writeStamp({
    webDir: webArg === undefined ? undefined : path.resolve(webArg),
    distDir: distArg === undefined ? undefined : path.resolve(distArg),
    contract: contractArg === undefined ? undefined : path.resolve(contractArg),
  })
  process.stdout.write(`build stamp: ${file}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`build stamp: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
