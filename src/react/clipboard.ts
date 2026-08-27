/**
 * Text to the clipboard, by whichever route the browser allows.
 *
 * ⚠️ SHARED BY THE CODE BUTTON AND THE PAGE BUTTON, BECAUSE THE FALLBACK IS
 * THE HARD PART AND THERE MUST BE EXACTLY ONE OF IT. Both controls copy text
 * on click, both run in the same pages, and a second copy of this would drift
 * — one of them growing the `execCommand` path and the other quietly failing
 * over plain HTTP.
 */

export async function writeClipboard(text: string): Promise<boolean> {
  /*
   * `navigator.clipboard` is `undefined` outside a secure context, and
   * `next dev` served over `http://192.168.x.x:3000` — the standard way to
   * check a docs site on a real phone — is not one. Reading `isSecureContext`
   * first avoids a TypeError on the property access itself.
   */
  if (window.isSecureContext && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // A permissions policy can refuse even in a secure context; fall through
      // rather than reporting failure while an option remains.
    }
  }
  return legacyCopy(text);
}

/**
 * `execCommand('copy')`, which is deprecated and still the only thing that
 * works over plain HTTP.
 *
 * When it finally goes, this returns `false` and the reader gets the
 * instruction — which is why that message is written as an instruction rather
 * than as an apology.
 */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  // Off-screen rather than hidden: a `display: none` textarea cannot be
  // selected, and selection is the whole mechanism.
  area.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
  document.body.append(area);

  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
