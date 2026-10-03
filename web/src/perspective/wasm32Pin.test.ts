// @vitest-environment node
// The Perspective server runs as wasm32 and nothing else (roadmap D3.2, risk C08): the build with 64-bit
// memory (memory64) is not shipped in Safari's engine, and a threaded build needs shared memory, which the
// page's isolation does not give. The package carries both a 32-bit and a 64-bit server and prefers the
// 64-bit one where the host can run it, so three things are pinned: the engine registers the 32-bit file
// only (engine.ts), no other page code names the 64-bit file, and the file it registers really holds 32-bit,
// unshared memory (read from the WebAssembly bytes, so a package update that swaps the build fails here).
import { describe, expect, it } from 'vitest'

// The app tsconfig carries browser types only, so the Node built-ins are typed here by hand.
const builtin = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process.getBuiltinModule
const fs = builtin('node:fs') as {
  readFileSync(path: string): Uint8Array
  readFileSync(path: string, encoding: 'utf-8'): string
  readdirSync(path: string): string[]
  statSync(path: string): { isDirectory(): boolean }
}
const { join, relative } = builtin('node:path') as { join(...parts: string[]): string; relative(from: string, to: string): string }
const { fileURLToPath } = builtin('node:url') as { fileURLToPath(url: URL): string }
const { readFileSync, readdirSync, statSync } = fs

const WEB = fileURLToPath(new URL('../../', import.meta.url))
const SERVER_DIR = join(WEB, 'node_modules', '@perspective-dev', 'server', 'dist', 'wasm')
const SERVER_WASM = join(SERVER_DIR, 'perspective-server.wasm')
const SERVER_WASM64 = join(SERVER_DIR, 'perspective-server.memory64.wasm')
const ENGINE = join(WEB, 'src', 'perspective', 'engine.ts')

interface MemoryLimits {
  readonly memory64: boolean
  readonly shared: boolean
}

class Reader {
  private at = 0
  private readonly bytes: Uint8Array
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }
  get done(): boolean {
    return this.at >= this.bytes.length
  }
  byte(): number {
    const value = this.bytes[this.at]
    if (value === undefined) throw new Error('truncated WebAssembly')
    this.at += 1
    return value
  }
  /** An unsigned LEB128 integer (up to 64 bits, read as a number: sizes and counts here are small). */
  leb(): number {
    let result = 0
    let scale = 1
    for (;;) {
      const b = this.byte()
      result += (b & 0x7f) * scale
      if ((b & 0x80) === 0) return result
      scale *= 128
    }
  }
  skip(count: number): void {
    this.at += count
  }
  name(): string {
    const length = this.leb()
    const text = new TextDecoder().decode(this.bytes.subarray(this.at, this.at + length))
    this.at += length
    return text
  }
  slice(length: number): Reader {
    const part = new Reader(this.bytes.subarray(this.at, this.at + length))
    this.at += length
    return part
  }
}

/** A limits entry: flag bit 0 = has a maximum, bit 1 = shared, bit 2 = 64-bit. */
function readLimits(r: Reader): MemoryLimits {
  const flag = r.byte()
  r.leb()
  if ((flag & 0x01) !== 0) r.leb()
  return { memory64: (flag & 0x04) !== 0, shared: (flag & 0x02) !== 0 }
}

function readImportMemories(r: Reader, into: MemoryLimits[]): void {
  const count = r.leb()
  for (let i = 0; i < count; i++) {
    r.name()
    r.name()
    const kind = r.byte()
    if (kind === 0) r.leb() // function: type index
    else if (kind === 1) {
      r.byte() // table: reference type, then limits
      readLimits(r)
    } else if (kind === 2) into.push(readLimits(r))
    else if (kind === 3) r.skip(2) // global: value type, mutability
    else if (kind === 4) {
      r.byte() // tag: attribute, then type index
      r.leb()
    } else throw new Error(`unknown import kind ${kind}`)
  }
}

/** Every linear memory a module imports or defines, read from its import and memory sections. */
function readMemories(bytes: Uint8Array): MemoryLimits[] {
  const magic = String.fromCharCode(...bytes.subarray(0, 4))
  if (magic !== '\0asm') throw new Error('not a WebAssembly module')
  const r = new Reader(bytes.subarray(8))
  const memories: MemoryLimits[] = []
  while (!r.done) {
    const id = r.byte()
    const section = r.slice(r.leb())
    if (id === 2) readImportMemories(section, memories)
    else if (id === 5) {
      const count = section.leb()
      for (let i = 0; i < count; i++) memories.push(readLimits(section))
    }
  }
  return memories
}

/** True when the module carries a custom section called `name`. */
function hasCustomSection(bytes: Uint8Array, name: string): boolean {
  const r = new Reader(bytes.subarray(8))
  while (!r.done) {
    const id = r.byte()
    const section = r.slice(r.leb())
    if (id === 0 && section.name() === name) return true
  }
  return false
}

/**
 * The server module itself. The package ships it as a small self-extracting module (stage 0) that holds the
 * real server in a custom section; the page's client unpacks it the same way (its stage 0 loader). A module
 * without that section is returned as it is.
 */
function unpackServer(bytes: Uint8Array): Uint8Array {
  if (!hasCustomSection(bytes, 'psp-runtime')) return bytes
  const module = new WebAssembly.Module(bytes as unknown as BufferSource)
  const instance = new WebAssembly.Instance(module)
  const exports = instance.exports as { memory: WebAssembly.Memory; resize(n: number): number; compile(n: number, len: number): number }
  const [packed] = WebAssembly.Module.customSections(module, 'psp-runtime')
  const [length] = WebAssembly.Module.customSections(module, 'psp-len')
  if (!packed || !length) throw new Error('the self-extracting server has no payload')
  const size = new DataView(length).getUint32(0, true)
  const into = exports.resize(packed.byteLength)
  new Uint8Array(exports.memory.buffer).set(new Uint8Array(packed), into)
  const out = exports.compile(packed.byteLength, size)
  return new Uint8Array(exports.memory.buffer).slice(out, out + size)
}

/** Why a server module is not the 32-bit, unshared build, or null when it is. */
function serverBuildProblem(bytes: Uint8Array): string | null {
  const memories = readMemories(unpackServer(bytes))
  if (memories.length === 0) return 'no linear memory found'
  if (memories.some((m) => m.memory64)) return 'a 64-bit memory (memory64)'
  if (memories.some((m) => m.shared)) return 'a shared memory (threads)'
  return null
}

/** Why the engine's source does not register the 32-bit server alone, or null when it does. */
function engineProblem(source: string): string | null {
  if (!/\.init_server\(\s*\{\s*wasm32\s*:/.test(source)) return 'init_server does not register { wasm32 }'
  if (/wasm64|memory64|\bsole\b/i.test(source)) return 'names a 64-bit or sole server'
  const servers = [...source.matchAll(/@perspective-dev\/server\/[^'"]*/g)].map((m) => m[0])
  if (servers.length !== 1 || servers[0] !== '@perspective-dev/server/dist/wasm/perspective-server.wasm?url') {
    return `imports ${servers.join(', ') || 'no server'} instead of the 32-bit server file`
  }
  return null
}

// A module with one memory section: count 1, then the limits flag and a minimum of 1 page.
const wasm = (...section: number[]): Uint8Array => new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...section])
const MEMORY32 = wasm(5, 3, 1, 0, 1)
const MEMORY64 = wasm(5, 3, 1, 4, 1)
const SHARED = wasm(5, 4, 1, 3, 1, 1)
const IMPORTED32 = wasm(2, 15, 1, 3, 0x65, 0x6e, 0x76, 6, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 2, 0, 1)
const IMPORTED64 = wasm(2, 15, 1, 3, 0x65, 0x6e, 0x76, 6, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 2, 4, 1)

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

describe('the WebAssembly reader', () => {
  it('reads defined and imported memories, and their 64-bit and shared flags', () => {
    expect(readMemories(MEMORY32)).toEqual([{ memory64: false, shared: false }])
    expect(readMemories(MEMORY64)).toEqual([{ memory64: true, shared: false }])
    expect(readMemories(SHARED)).toEqual([{ memory64: false, shared: true }])
    expect(readMemories(IMPORTED32)).toEqual([{ memory64: false, shared: false }])
    expect(readMemories(IMPORTED64)).toEqual([{ memory64: true, shared: false }])
  })

  it('refuses bytes that are not a module', () => {
    expect(() => readMemories(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow('not a WebAssembly module')
  })
})

describe('the Perspective server is the wasm32 build', () => {
  it('registers a 32-bit server file with 32-bit, unshared memory', () => {
    expect(serverBuildProblem(readFileSync(SERVER_WASM))).toBeNull()
  })

  it('born failing: a planted memory64 server fails, as does a shared one, and a module without memory', () => {
    expect(serverBuildProblem(MEMORY64)).toMatch(/memory64/)
    expect(serverBuildProblem(IMPORTED64)).toMatch(/memory64/)
    expect(serverBuildProblem(SHARED)).toMatch(/threads/)
    expect(serverBuildProblem(wasm())).toMatch(/no linear memory/)
    expect(serverBuildProblem(MEMORY32)).toBeNull()
  })

  it("born failing: the package's own memory64 server is what the check refuses", () => {
    expect(serverBuildProblem(readFileSync(SERVER_WASM64))).toMatch(/memory64/)
  })

  it('has the engine register that file alone', () => {
    expect(engineProblem(readFileSync(ENGINE, 'utf-8'))).toBeNull()
  })

  it('born failing: the engine check fails on a planted 64-bit registration or server file', () => {
    const good = readFileSync(ENGINE, 'utf-8')
    expect(engineProblem(good.replace('{ wasm32: () =>', '{ wasm32: () => 1, wasm64: () =>'))).toMatch(/64-bit/)
    expect(engineProblem(good.replace('perspective-server.wasm?url', 'perspective-server.memory64.wasm?url'))).toMatch(/64-bit/)
    expect(engineProblem(good.replace('init_server({ wasm32:', 'init_server({ wasm64:'))).toMatch(/wasm32/)
    expect(engineProblem(good.replace('perspective.init_server({ wasm32: () => fetchAsset(serverWasm.default) })', ''))).toMatch(/wasm32/)
    expect(engineProblem(good.replace('perspective-server.wasm?url', 'perspective-server.other.wasm?url'))).toMatch(/instead of the 32-bit/)
  })

  it('names the 64-bit server nowhere else in the page code or its build set-up', () => {
    const own = join('src', 'perspective', 'wasm32Pin.test.ts')
    const sources = [...walk(join(WEB, 'src')), join(WEB, 'vite.config.ts')].filter(
      (path) => /\.(ts|tsx|css)$/.test(path) && relative(WEB, path) !== own && !/\.test\.(ts|tsx)$/.test(path),
    )
    expect(sources.length).toBeGreaterThan(300)
    const hits = sources.filter((path) => /memory64|wasm64/i.test(readFileSync(path, 'utf-8'))).map((path) => relative(WEB, path))
    expect(hits).toEqual([])
  })
})
