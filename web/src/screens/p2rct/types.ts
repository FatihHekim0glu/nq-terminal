// Response types for the P2 views RG2 (trend regime), EX5 (capacity) and MV6 (term structure): aliases of the generated
// contract schema (backend/nq_terminal/models/regimes_capacity_term.py), as screens/roll/types.ts does, so the fixtures
// beside them (p2rct.fixtures.ts) and every field the panels read are checked by `tsc -b`.
import type { Schemas } from '../../api/types'

export type Tag = '[POST HOC]' | '[PRE-REG]'
export type TrendName = 'above' | 'below'

export type GateInfo = Schemas['GateInfo']
export type Context = Schemas['Context']
export type TrendRegimeRow = Schemas['TrendRegimeRow']
export type TrendRegimeView = Schemas['TrendRegimeView']
export type CapacityInstrument = Schemas['CapacityInstrument']
export type CapacityRow = Schemas['CapacityRow']
export type CapacitySession = Schemas['CapacitySession']
export type RunCapacity = Schemas['RunCapacity']
export type TermPoint = Schemas['TermPoint']
export type TermVoid = Schemas['TermVoid']
export type TermSummary = Schemas['TermSummary']
export type TermStructure = Schemas['TermStructure']
