// Test helpers for the grid and tile tests (imported by *.test.* files only, never by the app).
// jsdom has no layout, so the virtualised grid needs element sizes and a working scroll position;
// and the app tsconfig carries browser types only, so the Node file read is typed here by hand.

const builtins = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
const fs = builtins.getBuiltinModule('node:fs') as { readFileSync(path: URL, encoding: 'utf8'): string }

/** A text file next to the calling test (pass `new URL('./x', import.meta.url)`). */
export function readText(url: URL): string {
  return fs.readFileSync(url, 'utf8')
}

/**
 * Gives every element a box of `height` by 800px, a tall scroll height, a stored scrollTop and a
 * scrollTo that fires the scroll event after the calling handler returns, as a browser does.
 */
export function stubLayout(height = 400): void {
  const define = (name: string, desc: PropertyDescriptor) => Object.defineProperty(HTMLElement.prototype, name, { configurable: true, ...desc })
  const scrolled = new WeakMap<HTMLElement, number>()
  define('offsetHeight', { get: () => height })
  define('offsetWidth', { get: () => 800 })
  define('clientHeight', { get: () => height })
  define('scrollHeight', { get: () => 10_000_000 })
  define('scrollTop', {
    get(this: HTMLElement) {
      return scrolled.get(this) ?? 0
    },
    set(this: HTMLElement, v: number) {
      scrolled.set(this, v)
    },
  })
  define('scrollTo', {
    value(this: HTMLElement, opts: ScrollToOptions) {
      if (typeof opts.top === 'number') this.scrollTop = opts.top
      queueMicrotask(() => this.dispatchEvent(new Event('scroll')))
    },
  })
}
