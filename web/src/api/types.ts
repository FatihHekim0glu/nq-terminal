// Type helpers over the generated contract (schema.d.ts, never edited by hand).
// Only GET operations are addressable: the terminal is read only (PRD G6, DL5).
import type { components, paths } from './schema'

export type Schemas = components['schemas']
export type ErrorDetail = Schemas['ErrorDetail']

/** Every contract path that has a GET operation. */
export type ApiPath = {
  [P in keyof paths]: paths[P] extends { get: object } ? P : never
}[keyof paths]

type Operation<P extends ApiPath> = paths[P]['get']
type Params<P extends ApiPath> = Operation<P>['parameters']
type Responses<P extends ApiPath> = Operation<P>['responses']

type PathPart<P extends ApiPath> = [NonNullable<Params<P>['path']>] extends [never]
  ? { path?: never }
  : { path: NonNullable<Params<P>['path']> }

type QueryPart<P extends ApiPath> = [NonNullable<Params<P>['query']>] extends [never]
  ? { query?: never }
  : undefined extends Params<P>['query']
    ? { query?: NonNullable<Params<P>['query']> }
    : { query: NonNullable<Params<P>['query']> }

/** The path and query parameters a GET on `P` takes, as declared in the contract. */
export type RequestOf<P extends ApiPath> = PathPart<P> & QueryPart<P>

/** The JSON body of a successful (200) GET on `P`. */
export type SuccessOf<P extends ApiPath> = Responses<P> extends {
  200: { content: { 'application/json': infer Body } }
}
  ? Body
  : never

/** The HTTP status codes the contract declares as errors for `P`. */
export type ErrorStatusOf<P extends ApiPath> = Exclude<keyof Responses<P>, 200>

/** The JSON body of any declared error on `P` (ErrorDetail for every router today). */
export type ErrorBodyOf<P extends ApiPath> = {
  [S in ErrorStatusOf<P>]: Responses<P>[S] extends { content: { 'application/json': infer Body } } ? Body : never
}[ErrorStatusOf<P>]

export interface GetOptions {
  readonly signal?: AbortSignal
}

/** apiGet's trailing arguments: the request object is optional only when nothing in it is required. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- `{}` is the "no required keys" probe
export type GetArgs<P extends ApiPath> = {} extends RequestOf<P>
  ? [request?: RequestOf<P>, options?: GetOptions]
  : [request: RequestOf<P>, options?: GetOptions]
