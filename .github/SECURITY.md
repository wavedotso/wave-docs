# Security

## Reporting a vulnerability

Report it privately, through GitHub:

**<https://github.com/wavedotso/wave-docs/security/advisories/new>**

That opens a private advisory only the maintainers can see. Please do not open a
public issue, and please do not use it for a `npm audit` transitive-dependency
report — those are ordinary issues.

No email address here on purpose: an address on a public page is scraped within
hours, and a report that arrives in a spam folder is a report nobody read.

## What is in scope

This package turns markdown on your disk into hast at build time and renders it
inside your application, so the interesting boundary is **untrusted markdown**:
documentation from a fork, a pull request, or a content directory anyone can
write to.

In scope:

- Markup that escapes the hast tree into the rendered page — the pipeline never
  produces an HTML string and nothing is ever handed to
  `dangerouslySetInnerHTML`, and a way around that is a vulnerability.
- A frontmatter value, a fence meta string, a heading, a link or an image `src`
  that reaches an attribute unescaped.
- A content path that escapes `contentDir` — `../`, a symlink, or an encoded
  separator.
- A crafted YouTube id or image URL that becomes something other than a path
  segment.
- Anything that makes the build read or write a file outside the project.

Out of scope, though still worth an issue:

- Denial of service from a deliberately enormous or pathological document. This
  runs at build time on your own machine.
- A vulnerability in a transitive dependency with no path to exploit through
  this package's API. Report those upstream; `npm audit` output alone is not a
  report.
- Anything requiring an attacker who can already write to your source tree or
  your `node_modules`.

## Supported versions

Pre-1.0, only the latest minor. `0.5.x` today.

## What to expect

An acknowledgement, a fix or an explanation of why it is not one, and a
credited advisory unless you would rather not be named. No timeline is promised
here, because a promise nobody can keep is worse than none.
