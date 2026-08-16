/**
 * The error factory. Private — the *taxonomy* is public at
 * `@waveso/docs/errors`, but the ability to fabricate an error wearing this
 * package's prefix is not something a consumer needs.
 */

import type { DocsError, DocsErrorCode } from './errors.js';
import { DOCS_ERROR_PREFIX } from './errors.js';

/**
 * Build an error that names this package and says what class of thing failed.
 *
 * The message is passed through untouched apart from the prefix, which is added
 * only when absent — the wording at each throw site is the part a human reads,
 * and several of them took real effort to get right.
 *
 * `code` is attached non-enumerably so it does not appear in `JSON.stringify`
 * or a spread, which keeps error objects looking exactly as they did while
 * still being branchable.
 *
 * The stack is left alone. Flattening it would hide the `dist/` frames a
 * consumer does not care about, and also the ones a maintainer needs.
 */
export function docsError(
  code: DocsErrorCode,
  message: string,
  options?: ErrorOptions,
): DocsError {
  const error = new Error(
    message.startsWith(DOCS_ERROR_PREFIX)
      ? message
      : `${DOCS_ERROR_PREFIX}${message}`,
    options,
  );
  Object.defineProperty(error, 'code', {
    value: code,
    enumerable: false,
    writable: false,
    configurable: true,
  });
  return error as DocsError;
}
