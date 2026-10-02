// A stand-in for TanStack Query's infinite-query behaviour (v2.1 polish, SHELL-DIET-4). query-core's query.js imports
// infiniteQueryBehavior to run a query whose type is "infinite" (useInfiniteQuery, fetchInfiniteQuery): about 0.45 kB
// gzip of paging code that is in the first-paint shell only because Query reaches it by a plain import. The terminal
// has no infinite query: every read is a single GET page (src/api/queries*.ts). vite.config.ts (infiniteStub) sends
// that one import, from that one importer, here, so the paging code is in no build; a query that does ask for it
// fails loudly instead of fetching nothing. Only the name query.js reads is exported. To use infinite queries some day,
// drop the plugin and the shell ceilings in scripts/bundleCheck.ts pay for the code.
export function infiniteQueryBehavior(_pages?: number): never {
  throw new Error('Infinite queries are not available: see src/vendor/infiniteQueryBehaviorStub.ts')
}
