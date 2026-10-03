// The page's one deliberate write besides the backtest queue's two (03 section 10.3): the workspace store's versioned
// `PUT /api/workspaces/<document>`, to the page's own origin, for exactly the seven document names. A run that starts the
// store (the real-data smoke) allows this and nothing else beside GET: any other PUT, a PUT to a name that is not a
// document, a PUT with a query string or one to another origin is still reported.
export const STORE_DOCUMENTS = ['workspaces', 'layouts', 'linkGroups', 'watch', 'history', 'prefs', 'meta'] as const

const STORE_PATH = new RegExp(`^/api/workspaces/(?:${STORE_DOCUMENTS.join('|')})$`)

/** True for exactly the store's PUT on the page's own origin. */
export function isStoreWrite(method: string, url: string, origin: string): boolean {
  if (method !== 'PUT') return false
  const parsed = new URL(url)
  return parsed.origin === origin && parsed.search === '' && STORE_PATH.test(parsed.pathname)
}
