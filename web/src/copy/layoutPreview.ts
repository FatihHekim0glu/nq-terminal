// The templates of the <GO> preview row (roadmap #6): what Enter or Shift+Enter would do to the panels.
// Imported only by the lazy chrome/WorkspacePreview.ts, so they stay out of the shell. They are a module of
// their own because a second export in copy/layout.ts still rides into the shell chunk: the bundler keeps a
// module that the shell and a lazy chunk share whole. UK spelling, no dashes. `{name}` slots are filled by
// fillCopy() (copy/workspace.ts).

export const LAYOUT_PREVIEW = {
  replace: '<GO> replaces {panel} with {code}',
  add: '<Shift+GO> adds {code} in a new panel right of {panel}',
  addAlone: '<Shift+GO> opens {code} in a new panel',
  loadSaved: '<GO> restores your saved {screen} ({n} panels)',
  loadDefault: '<GO> loads the {screen} layout ({n} panels)',
  loadContext: '<GO> loads {screen} for this context ({n} panels)',
  retarget: 'retargets [{group}]: {panels}',
} as const
