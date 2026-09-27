// Gallery entry /__gallery/LineStack.linked (UI_SPEC section 2, link groups): two stacks in link group
// A share one crosshair; a third, unlinked stack keeps its own.
import { useMemo } from 'react'
import { LINE_STACK_GALLERY as G } from '../copy/lineStack'
import type { PanelLink } from '../state/linkGroups'
import LineStack from './LineStack'
import { smallStack, type GalleryStack } from './LineStack.galleryData'
import './LineStack.gallery.css'

function Cell({ id, heading, stack, link }: { readonly id: string; readonly heading: string; readonly stack: GalleryStack; readonly link: PanelLink }) {
  return (
    <section className="linestack-gallery-cell" aria-labelledby={id} data-link={link}>
      <h2 id={id}>{heading}</h2>
      <LineStack title={G.linkedTitle} t={stack.t} panes={stack.panes} link={link} />
    </section>
  )
}

export default function LineStackLinkedGallery() {
  const first = useMemo(() => smallStack(31), [])
  const second = useMemo(() => smallStack(32), [])
  const third = useMemo(() => smallStack(33), [])
  return (
    <div className="linestack-gallery">
      <div className="linestack-gallery-row">
        <Cell id="ls-a1" heading={G.linkedA1} stack={first} link="A" />
        <Cell id="ls-a2" heading={G.linkedA2} stack={second} link="A" />
      </div>
      <div className="linestack-gallery-row">
        <Cell id="ls-u" heading={G.unlinked} stack={third} link="-" />
      </div>
    </div>
  )
}
