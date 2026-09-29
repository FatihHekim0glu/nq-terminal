// The <GO> preview templates are read only by the lazy chrome/WorkspacePreview.ts, so they live in their own
// module (copy/layoutPreview.ts) and stay out of the LAYOUT object the shell holds (App, FrameStrip and
// StatusBar import it). A second export in copy/layout.ts was measured to ride into the shell chunk anyway
// (127,666 to 127,662 B gzip), because the bundler keeps a shared module whole.
import { describe, expect, it } from 'vitest'
import appSource from '../App.tsx?raw'
import frameStripSource from '../chrome/FrameStrip.tsx?raw'
import statusBarSource from '../chrome/StatusBar.tsx?raw'
import layoutSource from './layout.ts?raw'
import { LAYOUT, LAYOUT_SEPARATOR } from './layout'
import { LAYOUT_PREVIEW } from './layoutPreview'

const PREVIEW_KEYS = ['replace', 'add', 'addAlone', 'loadSaved', 'loadDefault', 'loadContext', 'retarget'] as const

describe('the layout copy the shell holds', () => {
  it.each(PREVIEW_KEYS)('LAYOUT has no %s template', (key) => {
    expect(LAYOUT).not.toHaveProperty(key)
  })

  it('has one separator, its own export, and none inside LAYOUT', () => {
    expect(LAYOUT_SEPARATOR).toBe(' | ')
    expect(LAYOUT).not.toHaveProperty('separator')
  })
})

describe('LAYOUT_PREVIEW: the templates of the <GO> preview row', () => {
  it('holds exactly the seven templates, with the words they always had', () => {
    expect(Object.keys(LAYOUT_PREVIEW).sort()).toEqual([...PREVIEW_KEYS].sort())
    expect({ ...LAYOUT_PREVIEW }).toEqual({
      replace: '<GO> replaces {panel} with {code}',
      add: '<Shift+GO> adds {code} in a new panel right of {panel}',
      addAlone: '<Shift+GO> opens {code} in a new panel',
      loadSaved: '<GO> restores your saved {screen} ({n} panels)',
      loadDefault: '<GO> loads the {screen} layout ({n} panels)',
      loadContext: '<GO> loads {screen} for this context ({n} panels)',
      retarget: 'retargets [{group}]: {panels}',
    })
  })

  it('is not imported by any file of the shell, and is not in the module the shell shares', () => {
    const shell = [['App.tsx', appSource], ['chrome/FrameStrip.tsx', frameStripSource], ['chrome/StatusBar.tsx', statusBarSource], ['copy/layout.ts', layoutSource]] as const
    for (const [file, source] of shell) {
      expect(source, file).not.toContain('LAYOUT_PREVIEW')
    }
  })
})
