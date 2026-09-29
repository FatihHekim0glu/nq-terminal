// A stand-in for "@radix-ui/react-dialog" (roadmap wave 7, SHELL-DIET-2). cmdk imports the real package for
// Command.Dialog only, and the terminal never renders that: it uses the inline Command list (chrome/CommandLine).
// The real dialog drags in the dismissable layer, focus scope, focus guards, portal and scroll lock (about 10 kB
// gzip in the shell), and cmdk's own code keeps them alive because Command.Dialog hangs off the Command object.
// vite.config.ts (RESOLVE_ALIASES) sends that one import here, so none of it is in any build.
//
// cmdk reads exactly these four names (src/vendor/radixDialogStub.test.tsx checks it against the installed
// cmdk). They fail loudly if Command.Dialog is ever rendered, rather than drawing nothing. To use a real dialog
// some day, drop the alias in vite.config.ts and the shell ceilings in scripts/bundleCheck.ts pay for it.

function unavailable(): never {
  throw new Error(
    "cmdk's Command.Dialog is not available: the terminal replaces @radix-ui/react-dialog with src/vendor/radixDialogStub.tsx " +
      '(web/vite.config.ts) to keep the dialog code out of the shell. Use the inline Command list, or remove the alias.',
  )
}

/** Renders nothing but an error: see the note at the top of the file. */
export function Root(_props: object): never {
  return unavailable()
}

export function Portal(_props: object): never {
  return unavailable()
}

export function Overlay(_props: object): never {
  return unavailable()
}

export function Content(_props: object): never {
  return unavailable()
}
