// Contract sync check (ARCHITECTURE section 4, "Contract discipline").
//
// `pnpm gen:api` (codegen/gen-api.mjs) writes src/api/schema.d.ts from terminal/contract/openapi.json and
// records the contract's sha256 twice: in src/api/openapi.sha256 and in the first line of schema.d.ts.
// The hash is taken over the contract with CRLF normalised to LF, because the backend writes the snapshot
// with Python's text mode (CRLF on Windows) and a checkout may flip line endings without changing the API.
// gen-api.mjs uses node:crypto with the same normalisation; the test recomputes it here with Web Crypto,
// so the two implementations check each other.

export const SCHEMA_HEADER_PREFIX = '// contract sha256: '
const SHA_RE = /^[0-9a-f]{64}$/

export function normaliseNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

export async function contractSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(normaliseNewlines(text))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The sha recorded in openapi.sha256 (its first whitespace-separated token), or null if malformed. */
export function readShaFile(text: string): string | null {
  const token = text.trim().split(/\s+/, 1)[0] ?? ''
  return SHA_RE.test(token) ? token : null
}

/** The sha recorded on the generated header line of schema.d.ts, or null when the header is missing. */
export function readSchemaHeaderSha(schema: string): string | null {
  const line = normaliseNewlines(schema)
    .split('\n')
    .find((l) => l.startsWith(SCHEMA_HEADER_PREFIX))
  const token = line?.slice(SCHEMA_HEADER_PREFIX.length).trim() ?? ''
  return SHA_RE.test(token) ? token : null
}

export interface ContractFiles {
  readonly contract: string
  readonly shaFile: string
  readonly schema: string
}

const REGENERATE = 'run `pnpm --dir terminal\\web gen:api`'

/** Every way the generated files disagree with the contract; [] when they are in sync. */
export async function contractSyncProblems(files: ContractFiles): Promise<string[]> {
  const expected = await contractSha256(files.contract)
  const recorded = readShaFile(files.shaFile)
  const header = readSchemaHeaderSha(files.schema)
  const problems: string[] = []
  if (recorded !== expected) {
    problems.push(`src/api/openapi.sha256 records ${recorded ?? 'no valid sha'}, contract is ${expected}: ${REGENERATE}`)
  }
  if (header !== expected) {
    problems.push(`src/api/schema.d.ts was generated from ${header ?? 'an unknown contract'}, contract is ${expected}: ${REGENERATE}`)
  }
  return problems
}
