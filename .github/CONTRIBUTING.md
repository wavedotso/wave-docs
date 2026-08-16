# Contributing

Thanks for looking. This describes how the repository works, not how quickly
anyone will get to your issue.

## Getting set up

```sh
pnpm install
pnpm test          # node + jsdom, under seven seconds
```

Node 26 and pnpm 11, both pinned in `package.json`. Corepack is not used and
must not be — it was unbundled in Node 25.

**Never `npm install` here.** A lockfile from another package manager is
gitignored and rejected by CI, because a second lockfile installs a second
dependency tree and the two disagree silently.

## The gauntlet

`prepublishOnly` runs the whole thing, and CI runs it plus three steps that
need a browser or a real build:

| Command | What it defends |
| --- | --- |
| `pnpm typecheck` | Strict TypeScript, `exactOptionalPropertyTypes` included |
| `pnpm lint` | Biome, formatting and rules together |
| `pnpm test` | 686 tests over Node and jsdom |
| `pnpm test:browser` | Real Chromium — jsdom reports every width as `0`, so every geometry claim lives here |
| `pnpm build` | tsdown, unbundled, one file per entry point |
| `pnpm test:smoke` | A real Next application built in both output modes against the published `exports` map |
| `pnpm check:readme` | Type-checks every example in the README as one project |
| `pnpm size` | Client bytes, payload ratio, render cost, and the README's own figures |
| `pnpm check:package` | publint and are-the-types-wrong against a packed tarball |

⚠️ Use `set -o pipefail` if you pipe any of these. `cmd | tail -1` reports the
exit code of `tail`, which is how a failing typecheck and a failing size budget
have each been committed here.

## A fix without a test that fails before it is not a fix

Write the test first, watch it fail, then fix the code. If you cannot make it
fail, you have not found the bug — you have found something else that is also
true.

Then **mutate the fix and watch the test fail again.** This is not ceremony. In
one week here it caught three tests that could not fail at all: an assertion on
an empty collection, a spy on a code path jsdom never reached, and a stub that
removed the very API the guard under test checked for. All three were green.
All three were worthless.

When a mutation *survives*, suspect the mutation first — most of ours turned out
to be no-ops we had convinced ourselves were real.

## Comments

The bar is: **why, and what breaks otherwise.** A comment restating the code is
noise; a comment recording the measurement behind a number is the most valuable
line in the file.

```ts
// ⚠️ RECTANGLES, NOT `offsetTop`. The scrollport is `position: sticky`, so it
// IS the offsetParent — `offsetTop` is already relative to it, and subtracting
// the port's own offset takes the header height off twice. Measured in
// Chromium at 1280×800: the item scrolled to 206 where 265 was correct.
```

Two conventions worth copying: `⚠️` in capitals for a trap that has already
been fallen into, and a number in a comment always carries how it was measured.

## Changesets

Every user-visible change needs one:

```sh
pnpm changeset
```

Pre-1.0, a breaking change is a **minor**. Say what breaks and what to do about
it — including changes that break *rendered output* rather than types, which no
compiler will catch for anyone.

## Things that will surprise you

- **`dynamicParams` must be a literal `false`.** Route segment config is parsed
  before the module runs.
- **Two route files, not `[[...slug]]`.** An optional catch-all leaves
  `/docs/index` live and serving byte-identical HTML.
- **No barrel files.** Every entry point is an explicit subpath in `exports`, so
  an import always names the file it came from.
- **The published package must have no install scripts.** No `preinstall`, no
  `postinstall`, and dependencies are chosen with that in mind — `rolldown`
  rather than `esbuild`, for one.
- **Token CSS must be inside an `@layer`.** An unlayered rule beats every
  layered one, so a consumer's own `:root` could never win.

## What to open

Bugs and questions: an issue, using the form. Its first field is a dropdown of
every error code this package throws, and picking the right one saves a round
trip.

Anything that changes public API: an issue before a pull request, please. The
surface is deliberately small — `docs.Layout` takes five props and a test fails
when someone adds a sixth, on purpose.

Security: see [SECURITY.md](./SECURITY.md). Not an issue.
