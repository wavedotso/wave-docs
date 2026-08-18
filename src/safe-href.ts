/**
 * The one allowlist of schemes this package will put in an `href`.
 *
 * Private — deliberately not an entry point.
 *
 * ⚠️ IT WAS THE MARKDOWN PATH'S ALONE, AND `meta.json` WENT ROUND IT. A hand
 * written nav entry — `{ "title": "Status", "href": "javascript:…" }` — reached
 * `<a href>` through `DocsSidebar` with nothing checking it, while the markdown
 * beside it was filtered by a comment calling the check load-bearing. Both paths
 * end at the same anchor, so both need the same rule, and a rule with two copies
 * is a rule with one that is out of date.
 *
 * Node-safe and browser-safe: two regular expressions and two functions, no
 * imports at all.
 */

/**
 * Any URL with a scheme, or protocol-relative.
 */
const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * The schemes a link may carry.
 *
 * GitHub's own allowlist, which is the bar to match: documentation links to
 * `sms:`, `ftp:` and `irc:` are ordinary, and an allowlist of three silently
 * deleted them. The point of the check is to stop `javascript:`, `data:` and
 * `vbscript:` reaching an `href`, not to have an opinion about protocols.
 *
 * A scheme not listed here — `vscode:`, `obsidian:`, `slack:` — is refused
 * rather than rendered. That is deliberate: an allowlist that grows on request
 * is safe, one that guesses is not.
 */
const SAFE_SCHEME =
  /^(https?|mailto|tel|sms|ftp|ftps|irc|ircs|xmpp|news|nntp|feed|git|matrix):/i;

/**
 * Strip the characters a browser ignores inside a URL.
 *
 * `java\nscript:` and `java&#09;script:` are `javascript:` to a parser and not
 * to a naive regular expression, so the test has to run on the string the
 * browser will see rather than on the one that was written.
 */
export function normaliseUrl(href: string): string {
  return [...href].filter((char) => (char.codePointAt(0) ?? 0) > 0x20).join('');
}

/**
 * Would this href navigate somewhere we are willing to send a reader?
 *
 * Nothing upstream filters it on the markdown side: `remarkDocLinks` skips every
 * href with a scheme, so `assertLinks` never sees one either, and `remarkRehype`
 * runs with `allowDangerousHtml` off but passes a link's own url through
 * untouched. Verified against React 19: it neutralises `javascript:` in every
 * obfuscated form, silently — but it lets `vbscript:` and
 * `data:text/html;base64,…` reach the DOM verbatim. So the allowlist is ours.
 */
export function isSafeHref(href: string): boolean {
  const normalised = normaliseUrl(href);
  // No scheme at all — a route, a relative path, `#anchor`, `?query`.
  if (!ABSOLUTE_URL.test(normalised)) {
    return true;
  }
  // Protocol-relative inherits the page's own scheme, which is http(s).
  return normalised.startsWith('//') || SAFE_SCHEME.test(normalised);
}

/**
 * Does following this href leave the site in a new tab?
 *
 * ⚠️ NOT "HAS A SCHEME". `meta.json` used that test, so a `mailto:` sidebar
 * entry was given `target="_blank"` and announced as "(opens in a new tab)" — a
 * tab that never opens, described to precisely the reader who cannot see that it
 * did not. Only http(s) and protocol-relative navigate; `mailto:` and `tel:`
 * hand off to the OS and leave the page where it is.
 */
export function opensInNewTab(href: string): boolean {
  const normalised = normaliseUrl(href);
  return /^https?:\/\//i.test(normalised) || normalised.startsWith('//');
}
