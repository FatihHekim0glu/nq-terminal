// The lists the three window watches share, read out of their sources so a test can compare them (0.3.1 part 2).
// scope.rs (the Rust watches), winwatch.mjs (the harness) and watch.ts (the desktop end-to-end project) each declare the
// system host images, the host window classes, the known foreign programs and the environment variable that adds to
// them; the sources are read as text here, never imported, so the Rust copy can be compared at all.
export const COPIES = Object.freeze({
  rust: 'desktop/src-tauri/tests/hidden_support/scope.rs',
  harness: 'desktop/harness/lib/winwatch.mjs',
  e2e: 'web/e2e/desktop/watch.ts',
})

/** What each list is called (the three copies use the same names). */
const NAMES = { images: 'SYSTEM_HOST_IMAGES', classes: 'SYSTEM_HOST_CLASSES', known: 'KNOWN_FOREIGN', env: 'KNOWN_FOREIGN_ENV' }
export const LIST_NAMES = ['images', 'classes', 'known']

const QUOTED = /["']([^"']*)["']/g

/** The strings of `const NAME ... = [ ... ]` (any of the three languages), lower-cased. */
export function extractList(text, name) {
  const found = new RegExp(`\\bconst\\s+${name}\\b[^=]*=\\s*\\[([^\\]]*)\\]`).exec(text)
  if (found === null) throw new Error(`no list ${name} in the text`)
  return [...found[1].matchAll(QUOTED)].map((m) => m[1].toLowerCase())
}

/** The string of `const NAME ... = "..."`, lower-cased. */
export function extractString(text, name) {
  const found = new RegExp(`\\bconst\\s+${name}\\b[^=]*=\\s*["']([^"']*)["']`).exec(text)
  if (found === null) throw new Error(`no string ${name} in the text`)
  return found[1].toLowerCase()
}

/** The lists of every copy: { rust: { images, classes, known, env }, ... } from the copies' source texts. */
export function listsOf(texts) {
  const out = {}
  for (const copy of Object.keys(COPIES)) {
    out[copy] = {
      images: extractList(texts[copy], NAMES.images),
      classes: extractList(texts[copy], NAMES.classes),
      known: extractList(texts[copy], NAMES.known),
      env: extractString(texts[copy], NAMES.env),
    }
  }
  return out
}

const sorted = (list) => [...list].sort()
const only = (x, y) => x.filter((v) => !y.includes(v))

/** One line per list on which a copy differs from the Rust copy, naming the copy, the list and the difference. */
export function drift(lists) {
  const [base, ...others] = Object.keys(COPIES)
  const lines = []
  for (const copy of others) {
    for (const name of [...LIST_NAMES, 'env']) {
      const a = name === 'env' ? [lists[base][name]] : sorted(lists[base][name])
      const b = name === 'env' ? [lists[copy][name]] : sorted(lists[copy][name])
      if (JSON.stringify(a) === JSON.stringify(b)) continue
      lines.push(`${name}: ${copy} differs from ${base}: only in ${copy} [${only(b, a)}], only in ${base} [${only(a, b)}]`)
    }
  }
  return lines
}
