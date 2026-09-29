// Two tiny helpers shared by the record watch and the layout signature: a 32 bit FNV-1a hash and a JSON
// text with the keys sorted, so one record hashes to one digest whatever order its keys arrived in.

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

/** FNV-1a (32 bit) of a string, as 8 hex digits. Enough to tell two records apart, not a proof. */
export function fnv1a(text: string): string {
  let hash = FNV_OFFSET
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function encode(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => encode(item)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>
    // Sorted as text, and written by hand: an object rebuilt in sorted order would put numeric looking
    // keys back in numeric order, which is the engine's business and not a fixed rule.
    const parts = Object.keys(record)
      .sort()
      .flatMap((key) => (record[key] === undefined ? [] : [`${JSON.stringify(key)}:${encode(record[key])}`]))
    return `{${parts.join(',')}}`
  }
  // JSON.stringify gives undefined for undefined and functions; inside an array JSON writes null.
  return JSON.stringify(value) ?? 'null'
}

/** JSON text with object keys sorted at every depth; arrays keep their sequence. */
export function canonicalJson(value: unknown): string {
  return encode(value)
}
