<!--
Delete any section that does not apply. An empty heading is worse than a
missing one.
-->

## What changes

<!-- One or two sentences. What a reader of the changelog needs, not a
     restatement of the diff. -->

## Why

<!-- The problem, and how you know it is one. If there is a number, say how it
     was measured — a corpus, a viewport, a machine state. -->

## The test that failed first

<!-- Which test, and what it reported before the fix. "A fix without a test
     that fails before it is not a fix."

     Then: which mutation of your fix did you check the test catches? Most
     surviving mutations here turn out to be no-ops, so name the real one. -->

## Checklist

- [ ] `pnpm typecheck && pnpm lint && pnpm test` — green
- [ ] `pnpm test:browser` — if anything touched `src/react/**` or `src/styles.css`
- [ ] `pnpm test:smoke` — if anything touched `src/next.ts` or the `exports` map
- [ ] `pnpm size` — if anything touched a `'use client'` module or the pipeline
- [ ] A changeset, if a user would notice
- [ ] Comments say *why*, and any number carries how it was measured

## Breaking

<!-- Pre-1.0, breaking is a minor. Two kinds, and the second is the one people
     forget:

     - Types or names: the compiler tells them.
     - Rendered output — an element that changed, a class that moved, an
       attribute that appeared: nothing tells them. Say so explicitly, and put
       it in the changeset.

     Write "none" if none. -->
