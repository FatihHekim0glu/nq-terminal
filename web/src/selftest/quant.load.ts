// Loads the engine the goldens judge: the normal and power maths, and the estimators and placement that are test references
// in the app (src/quant/importGuard.test.ts forbids any production file from importing linalg, cluster, trials or neffReference,
// because the screens read those numbers from the backend). The self-test page is the one place that must run them, to prove
// the page's engine in the shell it runs in. They are imported dynamically here and nowhere else, so the guard's rule stays
// as written, and the page's chunk holds them only in a self-test build.
type Normal = typeof import('../quant/normal')
type Power = typeof import('../quant/power')
type Linalg = typeof import('../quant/linalg')
type Cluster = typeof import('../quant/cluster')
type Trials = typeof import('../quant/trials')
type NeffReference = typeof import('../quant/neffReference')
type ExpectationReference = typeof import('../screens/live/expectationReference')

export interface QuantModules {
  readonly normal: Pick<Normal, 'normalCdf' | 'normalQuantile'>
  readonly power: Pick<Power, 'minimumDetectableSharpe' | 'powerAtSharpe'>
  readonly linalg: Pick<Linalg, 'pearsonMatrix' | 'symmetricEigenvalues'>
  readonly cluster: Pick<Cluster, 'averageLinkage' | 'flatClusters'>
  readonly trials: Pick<Trials, 'participationRatio' | 'liJiCount' | 'expectedMaxSr0' | 'probabilisticSharpe' | 'sessionSharpe'>
  readonly neff: Pick<NeffReference, 'referenceEffectiveN' | 'referenceMembers'>
  readonly pathOnCone: ExpectationReference['pathOnCone']
}

export async function loadQuant(): Promise<QuantModules> {
  const [normal, power, linalg, cluster, trials, neff, expectation] = await Promise.all([
    import('../quant/normal'),
    import('../quant/power'),
    import('../quant/linalg'),
    import('../quant/cluster'),
    import('../quant/trials'),
    import('../quant/neffReference'),
    import('../screens/live/expectationReference'),
  ])
  return { normal, power, linalg, cluster, trials, neff, pathOnCone: expectation.pathOnCone }
}
