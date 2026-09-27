// Panels for the ECharts gallery entries (gallery builds only): each chart under an amber heading,
// side by side, filling the gallery page. The chart id names its draw measure for the E2E run.
import { useId, type ReactNode } from 'react'
import './echartsGallery.css'

export function GalleryPanel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const id = useId()
  return (
    <section className="echarts-gallery-panel" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  )
}

export function GalleryPanels({ children }: { readonly children: ReactNode }) {
  return <div className="echarts-gallery">{children}</div>
}
