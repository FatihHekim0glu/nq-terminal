// The print dossier as React text (roadmap 15 part 3): the dossier of the focused panel laid out for the printed
// page, in the order the evidence pack uses (header, series, story, charts, evidence, sources, footer). Pure
// presentation: it takes the dossier and its charts as props, uses no provider and no hook, makes no request and
// computes nothing. Every string is a React text node, so a title with markup in it prints as the characters it
// is; no HTML is ever set from a string. A chart is drawn only when its address is a PNG data address
// (PNG_DATA_URL, checked again here whoever made the image). The stylesheet (print.css) shows this article only
// on paper. Lazy code: only the dynamic import in the Workspace's export menu reaches it.
import type { ReactElement } from 'react'
import { DOSSIER } from '../../copy/dossier'
import { fillCopy } from '../../copy/workspace'
import type { Dossier, DossierFigure, DossierSection, DossierTable, DossierText } from '../dossier/types'
import { PNG_DATA_URL } from '../prepare'

export interface PrintDossierProps {
  readonly dossier: Dossier
  /** The panel's charts as images; the ones whose address is not a PNG data address are left out. */
  readonly figures: readonly DossierFigure[]
}

/** A size in whole pixels for the width or height attribute, or null when it is not a usable number. */
function pixels(size: number): number | null {
  const whole = Math.round(size)
  return Number.isFinite(size) && whole >= 1 ? whole : null
}

/** Both attributes, or neither: half a size would stretch the picture. */
function sizeOf(figure: DossierFigure): { width?: number; height?: number } {
  const width = pixels(figure.width)
  const height = pixels(figure.height)
  return width === null || height === null ? {} : { width, height }
}

const hasText = (text: string | null): text is string => text !== null && text.trim() !== ''

function Table({ table }: { readonly table: DossierTable }): ReactElement {
  return (
    <>
      {hasText(table.note) ? <p className="prt-muted">{table.note}</p> : null}
      <table className="prt-table">
        <caption className="sr-only">{table.title}</caption>
        {table.columns.length === 0 ? null : (
          <thead>
            <tr>
              {table.columns.map((column, i) => (
                <th key={i} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((value, c) => (
                <td key={c}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function Lines({ text }: { readonly text: DossierText }): ReactElement {
  // Quoted research text is laid out as it was written; anything else is one paragraph per line.
  if (text.verbatim) return <pre className="prt-pre">{text.lines.join('\n')}</pre>
  return (
    <>
      {text.lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </>
  )
}

function Block({ section }: { readonly section: DossierSection }): ReactElement {
  return (
    <section className="prt-block">
      <h2>{section.title}</h2>
      {section.kind === 'table' ? <Table table={section} /> : <Lines text={section} />}
    </section>
  )
}

function Figures({ figures }: { readonly figures: readonly DossierFigure[] }): ReactElement | null {
  // Whoever made the images, only a PNG data address is ever drawn.
  const kept = figures.filter((figure) => PNG_DATA_URL.test(figure.dataUrl))
  if (kept.length === 0) return null
  return (
    <section className="prt-figures">
      <h2>{DOSSIER.sections.figures}</h2>
      <p className="prt-muted">{DOSSIER.figureNote}</p>
      <div className="prt-figure-grid">
        {kept.map((figure, i) => (
          <figure key={i} className="prt-figure">
            <img src={figure.dataUrl} alt={figure.summary} {...sizeOf(figure)} />
            <figcaption>{figure.summary}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}

/**
 * The dossier as an article: header (title, subtitle, flags), the series table, the story, the charts, the
 * evidence (which print.css starts on a new page), the sources and the footer. A part with nothing in it is
 * left out.
 */
export function PrintDossier({ dossier, figures }: PrintDossierProps): ReactElement {
  return (
    <article className="prt" aria-label={fillCopy(DOSSIER.printLabel, { title: dossier.title })}>
      <header className="prt-head">
        <h1>{dossier.title}</h1>
        {hasText(dossier.subtitle) ? <p className="prt-sub">{dossier.subtitle}</p> : null}
        {dossier.flags.length === 0 ? null : (
          <ul className="prt-flags">
            {dossier.flags.map((flag, i) => (
              <li key={i}>{flag}</li>
            ))}
          </ul>
        )}
      </header>
      {dossier.meta.length === 0 ? null : (
        <table className="prt-meta">
          <caption className="sr-only">{DOSSIER.sections.meta}</caption>
          <tbody>
            {dossier.meta.map(([label, value], i) => (
              <tr key={i}>
                <th scope="row">{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {dossier.story.length === 0 ? null : (
        <div className="prt-story">
          {dossier.story.map((section, i) => (
            <Block key={i} section={section} />
          ))}
        </div>
      )}
      <Figures figures={figures} />
      {dossier.evidence.length === 0 ? null : (
        <section className="prt-evidence">
          {dossier.evidence.map((section, i) => (
            <Block key={i} section={section} />
          ))}
        </section>
      )}
      {dossier.sources.length === 0 ? null : (
        <section className="prt-sources">
          <h2>{DOSSIER.sections.sources}</h2>
          <ul>
            {dossier.sources.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}
      {dossier.footer.length === 0 ? null : (
        <footer className="prt-foot">
          {dossier.footer.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </footer>
      )}
    </article>
  )
}
