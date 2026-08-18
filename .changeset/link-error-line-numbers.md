---
'@waveso/docs': minor
---

**Link errors now name the line the link is on.** Every `broken-link`, `draft-link` and `alias-link` reported a line number offset by the length of the frontmatter block — which is to say, a wrong one, on every page that has frontmatter, which is every page.

`vfile-matter` with `strip: true` deletes the block from the body, so remark counts `node.position.start.line` from the first line of the *body*. The error prints `relativePath:line`, the exact `file:line` form a terminal and an editor turn into a jump. A page with `title`, `description`, `label` and `order` — four fields and two delimiters — is six lines out:

```
- @waveso/docs: setup.md:4 links to './nowhere.md', which resolves to '/docs/nowhere'
+ @waveso/docs: setup.md:10 links to './nowhere.md', which resolves to '/docs/nowhere'
```

Line 4 is the middle of a block that is no longer there. Locatability is that error's entire job.

**The fix is padding rather than arithmetic.** `DocFile` carries a new `frontmatterLines`, set by the scan, and the renderer prepends that many newlines to what the parser sees. A blank line produces no markdown node, so it costs nothing in the output — and every position downstream is simply correct, including any a future plugin reports, which an offset applied at the four known throw sites would not be.

`content` is untouched. It is public, its exact value is pinned by tests, and a consumer measuring it should not have to know about this.

`frontmatterLines` is optional and treated as `0` when absent, so a host loading content itself — the documented reason `@waveso/docs/render` is an entry point — is unaffected.

**Why nothing caught it:** the render tests hand the renderer a body they wrote themselves, with no frontmatter and therefore no offset, and the source tests never render. The defect lived in the seam and was invisible from either side; the new tests scan a real file and render it.
