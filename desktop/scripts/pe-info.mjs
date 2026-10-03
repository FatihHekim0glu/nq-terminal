// PE reader for the shell's exe (from the W0A probe reader): the RT_MANIFEST resources with the requested
// execution level, the subsystem, and the import and delay-import tables. Node built-ins only.
//
// Usage:
//   node desktop/scripts/pe-info.mjs <exe> [--json]   dump
//   node desktop/scripts/pe-info.mjs <exe> --check    fail (exit 1) unless: the subsystem is windows; exactly one
//       RT_MANIFEST with Common-Controls 6.0, PerMonitorV2 and asInvoker; no MinGW runtime import; every other
//       import a system DLL, except WebView2Loader.dll, which the GNU host links dynamically and the artefact check
//       allows by pinned hash (W0A P5). --no-loader also refuses WebView2Loader.dll (an MSVC build has none).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RT_MANIFEST = 24
const DIR_IMPORT = 1
const DIR_RESOURCE = 2
const DIR_DELAY_IMPORT = 13
const SUBSYSTEM_GUI = 2
const SUBSYSTEM_CONSOLE = 3

export const MINGW_RUNTIME = /^(libgcc_s_[a-z0-9_-]+|libwinpthread-\d+|libstdc\+\+-\d+|libssp-\d+|libquadmath-\d+)\.dll$/i
export const LOADER = 'webview2loader.dll'

export function readPe(file) {
  const b = fs.readFileSync(file)
  if (b.readUInt16LE(0) !== 0x5a4d) throw new Error('not an MZ file')
  const pe = b.readUInt32LE(0x3c)
  if (b.readUInt32LE(pe) !== 0x4550) throw new Error('no PE signature')
  const coff = pe + 4
  const nSections = b.readUInt16LE(coff + 2)
  const optSize = b.readUInt16LE(coff + 16)
  const opt = coff + 20
  const magic = b.readUInt16LE(opt)
  const dirBase = opt + (magic === 0x20b ? 112 : 96)
  const dirs = [...Array(16).keys()].map((i) => ({ rva: b.readUInt32LE(dirBase + i * 8), size: b.readUInt32LE(dirBase + i * 8 + 4) }))
  const sections = [...Array(nSections).keys()].map((i) => {
    const s = opt + optSize + i * 40
    return { name: b.toString('latin1', s, s + 8).replace(/\0+$/, ''), vsize: b.readUInt32LE(s + 8), rva: b.readUInt32LE(s + 12),
      rawSize: b.readUInt32LE(s + 16), raw: b.readUInt32LE(s + 20) }
  })
  const off = (rva) => {
    const s = sections.find((x) => rva >= x.rva && rva < x.rva + Math.max(x.vsize, x.rawSize))
    if (!s) throw new Error(`rva ${rva.toString(16)} outside sections`)
    return rva - s.rva + s.raw
  }
  const cstr = (o) => b.toString('latin1', o, b.indexOf(0, o))
  return { b, magic, dirs, sections, off, cstr, subsystem: b.readUInt16LE(opt + 68) }
}

/** Every resource leaf as { type, name, lang, size, data }. */
export function resources(p) {
  const { b, dirs, off } = p
  if (!dirs[DIR_RESOURCE].rva) return []
  const base = off(dirs[DIR_RESOURCE].rva)
  const entries = (dirOff) => {
    const count = b.readUInt16LE(dirOff + 12) + b.readUInt16LE(dirOff + 14)
    return [...Array(count).keys()].map((i) => {
      const e = dirOff + 16 + i * 8
      const nameField = b.readUInt32LE(e)
      const target = b.readUInt32LE(e + 4)
      let name = nameField & 0xffff
      if (nameField & 0x80000000) {
        const s = base + (nameField & 0x7fffffff)
        name = b.toString('utf16le', s + 2, s + 2 + b.readUInt16LE(s) * 2)
      }
      return { name, at: base + (target & 0x7fffffff) }
    })
  }
  const leaves = []
  for (const t of entries(base)) for (const n of entries(t.at)) for (const l of entries(n.at)) {
    const rva = b.readUInt32LE(l.at)
    const size = b.readUInt32LE(l.at + 4)
    leaves.push({ type: t.name, name: n.name, lang: l.name, size, data: b.subarray(off(rva), off(rva) + size) })
  }
  return leaves
}

export function manifests(p) {
  return resources(p).filter((r) => r.type === RT_MANIFEST).map((r) => ({
    id: r.name, lang: `0x${Number(r.lang).toString(16).padStart(4, '0')}`, size: r.size,
    text: r.data.toString('utf8').replace(/^\uFEFF/, ''),
  }))
}

export function imports(p) {
  const { b, dirs, off, cstr } = p
  const list = []
  if (dirs[DIR_IMPORT].rva) {
    for (let d = off(dirs[DIR_IMPORT].rva); b.readUInt32LE(d + 12) !== 0; d += 20) list.push({ dll: cstr(off(b.readUInt32LE(d + 12))), delay: false })
  }
  if (dirs[DIR_DELAY_IMPORT].rva) {
    for (let d = off(dirs[DIR_DELAY_IMPORT].rva); b.readUInt32LE(d + 4) !== 0; d += 32) list.push({ dll: cstr(off(b.readUInt32LE(d + 4))), delay: true })
  }
  return list
}

/** Which manifest entries a manifest text carries. */
export function manifestEntries(text) {
  return {
    commonControls6: /Microsoft\.Windows\.Common-Controls"[^>]*version="6\.0\.0\.0"|version="6\.0\.0\.0"[^>]*Microsoft\.Windows\.Common-Controls/s.test(text),
    dpiAwareness: (text.match(/<dpiAwareness[^>]*>([^<]*)</) || [])[1] ?? null,
    dpiAware: (text.match(/<dpiAware[^>]*>([^<]*)</) || [])[1] ?? null,
    executionLevel: (text.match(/requestedExecutionLevel[^>]*level="([^"]+)"/) || [])[1] ?? null,
    longPathAware: /<longPathAware>true</.test(text),
  }
}

/** A DLL Windows itself provides: an API set, or a file in the system folder. */
export function isSystemDll(name, systemDir = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')) {
  if (/^(api|ext)-ms-win-/i.test(name)) return true
  return fs.existsSync(path.join(systemDir, name))
}

export function info(file) {
  const p = readPe(file)
  const subsystem = p.subsystem === SUBSYSTEM_GUI ? 'windows' : p.subsystem === SUBSYSTEM_CONSOLE ? 'console' : String(p.subsystem)
  return {
    file, size: p.b.length, subsystem,
    manifests: manifests(p).map((m) => ({ id: m.id, lang: m.lang, size: m.size, entries: manifestEntries(m.text), text: m.text })),
    imports: imports(p),
  }
}

/** The reasons an exe fails the shell's import and manifest rules (empty when it passes). */
export function problems(pe, { allowLoader = true, isSystem = isSystemDll } = {}) {
  const out = []
  if (pe.subsystem !== 'windows') out.push(`subsystem is ${pe.subsystem}, not windows (a console would open)`)
  if (pe.manifests.length !== 1) out.push(`${pe.manifests.length} RT_MANIFEST resources, expected exactly 1`)
  for (const m of pe.manifests) {
    if (!m.entries.commonControls6) out.push(`manifest ${m.id} lacks Common-Controls 6.0`)
    if (m.entries.dpiAwareness !== 'PerMonitorV2') out.push(`manifest ${m.id} dpiAwareness is ${m.entries.dpiAwareness}`)
    if (m.entries.executionLevel !== 'asInvoker') out.push(`manifest ${m.id} requests ${m.entries.executionLevel}`)
  }
  for (const { dll } of pe.imports) {
    if (MINGW_RUNTIME.test(dll)) out.push(`imports the MinGW runtime ${dll}`)
    else if (dll.toLowerCase() === LOADER) { if (!allowLoader) out.push(`imports ${dll}`) }
    else if (!isSystem(dll)) out.push(`imports ${dll}, which is not a system DLL`)
  }
  return out
}

function main(argv) {
  const [file, ...flags] = argv
  if (!file) {
    console.error('usage: node pe-info.mjs <exe> [--json | --check [--no-loader]]')
    return 2
  }
  const pe = info(file)
  if (flags.includes('--json')) {
    console.log(JSON.stringify(pe, null, 1))
  } else {
    console.log(`${file}  ${pe.size} bytes  subsystem=${pe.subsystem}`)
    for (const m of pe.manifests) console.log(`RT_MANIFEST id=${m.id} lang=${m.lang} size=${m.size} ${JSON.stringify(m.entries)}`)
    console.log('imports: ' + pe.imports.map((i) => i.dll + (i.delay ? ' (delay)' : '')).join(', '))
  }
  if (!flags.includes('--check')) return 0
  const found = problems(pe, { allowLoader: !flags.includes('--no-loader') })
  if (found.length) {
    console.error('pe-info check FAILED:\n  ' + found.join('\n  '))
    return 1
  }
  const loader = pe.imports.some((i) => i.dll.toLowerCase() === LOADER)
  console.log(`pe-info check passed: one manifest, asInvoker, no MinGW runtime${loader ? ', WebView2Loader.dll (allowed on the GNU host)' : ''}`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
