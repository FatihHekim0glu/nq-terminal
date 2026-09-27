// The gallery's URL rule: /__gallery lists the entries, /__gallery/<name> renders one. Names are
// file names (LineStack, Heatmap.corr): letters, digits, dots and dashes, so nothing from the URL
// reaches the page except a name that matches a registered file.
export const GALLERY_PREFIX = '/__gallery'

const NAME = /^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/

/** '' for the index, the entry name for an entry, null for any path outside the gallery. */
export function galleryNameFromPath(pathname: string): string | null {
  if (pathname === GALLERY_PREFIX || pathname === `${GALLERY_PREFIX}/`) return ''
  if (!pathname.startsWith(`${GALLERY_PREFIX}/`)) return null
  const rest = pathname.slice(GALLERY_PREFIX.length + 1).replace(/\/$/, '')
  if (!NAME.test(rest) || rest.includes('..')) return null
  return rest
}

export function galleryHref(name: string): string {
  return `${GALLERY_PREFIX}/${name}`
}
