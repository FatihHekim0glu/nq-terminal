// A stand-in for "@radix-ui/react-primitive" (v2.1 polish, SHELL-DIET-4). cmdk reads exactly two things from it:
// Primitive.div and Primitive.input, each a forwardRef element that renders its tag with the props it is given. The
// real package builds seventeen of these and hands each one an `asChild` mode that swaps the tag for Radix's Slot
// (about 2.9 kB raw of Slot code, with its own ref composition), which the terminal never asks for: no cmdk element
// in src/ passes asChild. vite.config.ts (RESOLVE_ALIASES) sends that one import here, so neither the other fifteen
// elements nor Slot is in any build (scripts/shellBudget.test.ts checks the build).
//
// What it keeps: the tag, every prop and the forwarded ref, which is all cmdk's output depends on
// (src/vendor/radixPrimitiveStub.test.tsx renders the same markup through the stub and through the real package).
// What it drops: asChild. A true asChild fails loudly rather than rendering the wrong element. To use asChild some
// day, drop the alias in vite.config.ts and the shell ceilings in scripts/bundleCheck.ts pay for Slot.
import { createElement, forwardRef, type ComponentPropsWithoutRef } from 'react'

type PrimitiveNode = 'div' | 'input'

function unavailable(node: PrimitiveNode): never {
  throw new Error(`asChild on Primitive.${node} needs Radix's Slot: see src/vendor/radixPrimitiveStub.tsx`)
}

function primitive<N extends PrimitiveNode>(node: N) {
  const Node = forwardRef<HTMLElementTagNameMap[N], ComponentPropsWithoutRef<N> & { readonly asChild?: boolean }>((props, ref) => {
    const { asChild, ...rest } = props
    if (asChild === true) return unavailable(node)
    return createElement(node, { ...rest, ref })
  })
  return Node
}

/** The two elements cmdk reads. */
export const Primitive = { div: primitive('div'), input: primitive('input') } as const
