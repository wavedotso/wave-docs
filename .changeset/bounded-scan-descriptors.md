---
'@waveso/docs': minor
---

**The content scan no longer opens every markdown file at once.** It failed on exactly the large documentation sets this package exists for, and it got worse as a site grew.

`scanDir` read its own pages with a bare `Promise.all` *and* recursed into its subdirectories with another, so the number of `readFile` calls in flight equalled the page count of the whole tree. Reproduced on a 1,201-page corpus at the 1,024-descriptor soft limit every Linux and CI image ships with: `next build` died with

```
Error: EMFILE: too many open files, open '<contentDir>/s33/p0829.md'
```

— no error code, no mention that this was the docs scan, and a filename out of a thousand that sends the author to inspect a page which is perfectly fine.

**Every filesystem call in the scan now goes through one process-wide semaphore**, bounded at 64. Process-wide rather than per-scan because descriptors are a process resource: two routes scanning two content directories would each stay under a per-scan bound and together exceed the only one that matters. The bound is on the leaf calls — `readFile`, `readdir`, `stat`, `realpath` — and deliberately not on the recursion, which would deadlock the moment every slot were held by a directory waiting for a slot to read its children.

**64 is chosen for the tightest descriptor limit, not for speed.** Measured over those 1,201 pages in 49 directories, nine runs, medians: **88 ms ungated, 106 ms at a bound of 16, 102 ms at 64, 101 ms at 128 and at 256.** Flat from 64 upwards — so the ~14 ms is the gate's own per-call overhead, not lost parallelism, and there is no speed to buy above 64. libuv's filesystem pool is four threads by default, so there was never 1,201-way parallelism there to lose. 14 ms sits against a build that highlights those same pages with Shiki, which is three orders of magnitude more.

**New error code `descriptor-limit`**, for when the limit is lower than the bound or something else in the process has the descriptors. It says which content directory was being scanned, that the scan holds at most 64 open, and that the fix is `ulimit -n` rather than a smaller corpus — the opposite of what a reader concludes from an error naming one of their own pages. Documented in the troubleshooting table and offered in the bug form.

The regression test asserts the invariant rather than the number: peak concurrent filesystem calls during a 300-page scan across 30 directories, which had 300 in flight before and has a fixed ceiling now however large the corpus.
