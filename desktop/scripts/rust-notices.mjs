// The third-party notices of the desktop shell (D7.4): desktop/src-tauri/THIRD_PARTY_NOTICES.txt, built from Cargo.lock with
// `cargo metadata` (declared licence, repository, folder of each crate) and the licence files in each crate, plus the Microsoft
// WebView2 loader the shell ships beside the exe. And the check that fails when the file and Cargo.lock part ways.
//
//   node desktop/scripts/rust-notices.mjs            write the notices (cargo metadata, crates already fetched)
//   node desktop/scripts/rust-notices.mjs --check    compare the notices with Cargo.lock only (no cargo, no crates)
//   options: --lock <Cargo.lock> --notices <file> --manifest <Cargo.toml> --metadata <saved cargo metadata json> --offline
//
//   exit 0  written, or the notices match Cargo.lock
//   exit 1  --check: a locked crate is missing from the notices, or the notices name one Cargo.lock no longer has
//   exit 2  a file could not be read, cargo failed, or a locked crate is unknown to cargo: a check that cannot run never passes
//
// The root crate (nq-lab-terminal, and any crate with no source, which is a path crate of this repository) is skipped: it is
// our own code, and bump-version.ps1 rewrites its Cargo.lock entry on every release, so listing it would invalidate the notices
// with each version bump. The layout, the index parser and the licence-file reader are shared with web/scripts/thirdPartyNotices.mjs.
// Every crate in Cargo.lock is listed, including the ones only another platform builds (Cargo.lock does not say which ship).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkNotices, collectLicenceTexts, describeMismatch, renderNotices } from '../../web/scripts/thirdPartyNotices.mjs'
import { isMainModule } from './main-module.mjs'

const TAURI = fileURLToPath(new URL('../src-tauri/', import.meta.url))
const DEFAULT_LOCK = path.join(TAURI, 'Cargo.lock')
const DEFAULT_NOTICES = path.join(TAURI, 'THIRD_PARTY_NOTICES.txt')
const DEFAULT_MANIFEST = path.join(TAURI, 'Cargo.toml')
const NO_LICENCE_FILE = 'no licence file in the package'
const MAX_METADATA_BYTES = 256 * 1024 * 1024

export const ROOT_CRATE = 'nq-lab-terminal'

// The licence of the WebView2 loader (WebView2Loader.dll, a Microsoft file linked by the webview2-com-sys crate and shipped beside
// the exe), as Microsoft publishes it with the Microsoft.Web.WebView2 package.
export const WEBVIEW2_LOADER = {
  name: 'Microsoft WebView2 loader (WebView2Loader.dll, shipped beside the exe)',
  license: 'BSD-3-Clause',
  text: `Copyright (C) Microsoft Corporation. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * The name of Microsoft Corporation, or the names of its contributors
may not be used to endorse or promote products derived from this
software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
}

const field = (block, key) => new RegExp(`^${key} = "([^"]*)"`, 'm').exec(block)?.[1]

/** The crates of a Cargo.lock that ship third-party code: [{ name, version }] in lockfile order, the root crate and path crates left out. */
export function lockedCrates(lockText) {
  const crates = []
  for (const block of lockText.replace(/\r\n?/g, '\n').split('[[package]]').slice(1)) {
    const name = field(block, 'name')
    const version = field(block, 'version')
    if (!name || !version || name === ROOT_CRATE || field(block, 'source') === undefined) continue
    crates.push({ name, version })
  }
  return crates
}

/** The notice record of a `cargo metadata` package: licence, repository and the texts of its licence files. */
export function collectCrate(meta) {
  const dir = path.dirname(meta.manifest_path)
  const texts = collectLicenceTexts(dir)
  if (meta.license_file) {
    const named = path.join(dir, meta.license_file)
    if (fs.existsSync(named)) texts.push(fs.readFileSync(named, 'utf8').replace(/\r\n?/g, '\n').trimEnd())
  }
  const unique = [...new Set(texts.filter((t) => t.length > 0))]
  return {
    name: meta.name,
    version: meta.version,
    license: meta.license ?? 'see the licence file',
    repository: meta.repository ?? '',
    texts: unique,
    note: unique.length > 0 ? '' : NO_LICENCE_FILE,
  }
}

/** One record per locked crate, from the cargo metadata. Throws for a crate cargo does not know. */
export function buildPackages(crates, metadata) {
  const byKey = new Map(metadata.packages.map((p) => [`${p.name} ${p.version}`, p]))
  return crates.map(({ name, version }) => {
    const meta = byKey.get(`${name} ${version}`)
    if (!meta) throw new Error(`cargo metadata does not list ${name} ${version}, which Cargo.lock does`)
    return collectCrate(meta)
  })
}

export function renderRustNotices(packages) {
  return renderNotices({
    heading: 'Third-party notices: nq-lab terminal, desktop shell (Cargo)',
    source: 'desktop/src-tauri/Cargo.lock (every locked crate except the root crate nq-lab-terminal)',
    command: 'node desktop/scripts/rust-notices.mjs',
    packages,
    extras: [WEBVIEW2_LOADER],
  })
}

/** The notices text against a Cargo.lock text. */
export function checkRustNotices(lockText, noticesText) {
  return checkNotices(lockedCrates(lockText), noticesText)
}

function parseArgs(argv) {
  const opts = { check: false, offline: false, lock: DEFAULT_LOCK, notices: DEFAULT_NOTICES, manifest: DEFAULT_MANIFEST, metadata: '' }
  const names = { '--lock': 'lock', '--notices': 'notices', '--manifest': 'manifest', '--metadata': 'metadata' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') opts.check = true
    else if (argv[i] === '--offline') opts.offline = true
    else if (names[argv[i]] && argv[i + 1] !== undefined) opts[names[argv[i]]] = path.resolve(argv[++i])
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  return opts
}

function readMetadata({ metadata, manifest, offline }) {
  if (metadata) return JSON.parse(fs.readFileSync(metadata, 'utf8'))
  const args = ['metadata', '--locked', '--format-version', '1', '--manifest-path', manifest, ...(offline ? ['--offline'] : [])]
  const result = spawnSync('cargo', args, { encoding: 'utf8', maxBuffer: MAX_METADATA_BYTES })
  if (result.error) throw new Error(`cargo could not be started: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`cargo metadata failed (exit ${result.status}): ${result.stderr.trim().split('\n').slice(-3).join(' | ')}`)
  return JSON.parse(result.stdout)
}

export function main(argv = process.argv.slice(2)) {
  try {
    const opts = parseArgs(argv)
    const lockText = fs.readFileSync(opts.lock, 'utf8')
    if (!opts.check) {
      const packages = buildPackages(lockedCrates(lockText), readMetadata(opts))
      fs.writeFileSync(opts.notices, renderRustNotices(packages))
      console.log(`wrote ${path.relative(process.cwd(), opts.notices)}: ${packages.length} crates`)
      return 0
    }
    const result = checkRustNotices(lockText, fs.readFileSync(opts.notices, 'utf8'))
    if (!result.ok) {
      console.error(describeMismatch(result, 'node desktop/scripts/rust-notices.mjs').join('\n'))
      return 1
    }
    console.log('third-party notices match Cargo.lock')
    return 0
  } catch (error) {
    console.error(`rust-notices: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
}

if (isMainModule(import.meta.url)) process.exitCode = main()
