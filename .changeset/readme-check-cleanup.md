---
'@waveso/docs': patch
---

**README examples compile again, and a failing check no longer litters the repo.**

⚠️ `process.exit` DOES NOT RUN `finally`, AND TWO CALLS WERE INSIDE THE `try`.
`scripts/check-readme.ts` builds a temporary project in the repository root —
inside it, so Node's own module resolution finds the real `node_modules` and
`@waveso/docs/next` resolves through the published `exports` map exactly as a
consumer resolves it. The cleanup is in a `finally`, so it only ever ran on a
*passing* check: every failure left a 76 KB directory behind, gitignored and
therefore unnoticed until there were 24 of them. A Ctrl-C did the same.

`process.exitCode` and a `return` end the run with the same status and let the
cleanup happen. Verified by forcing four failures in a row: none leaked.

And the check was failing. Three examples added with the corpus and the copy
button were missing their imports, and two claimed the same `lib/docs.ts` path —
which the script's own duplicate-path guard catches, because two fences claiming
one file tell a reader to put two different bodies in the same place. CI runs
`check:readme`, so this would have failed on push rather than shipped; it is not
in `pnpm test`, which is why it went unseen locally.
