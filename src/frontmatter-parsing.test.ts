/**
 * The byte-level cases a frontmatter parser has to get right.
 *
 * Written green against `gray-matter` **before** the swap to `vfile-matter`,
 * and deliberately not against the parser's own documentation: frontmatter is
 * the front door of this package, a regression in it is total, and "both
 * libraries say they handle YAML" is not a test.
 *
 * Driven through `createDocsSource` rather than the parser directly, because
 * the thing that must not change is what a *page* ends up with — the split
 * point between data and body, whether a `---` inside prose is mistaken for a
 * delimiter, and what a malformed block reports.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createDocsSource } from './source.js';
import type { DocFile } from './types.js';

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/**
 * Write `raw` as a page and read it back.
 *
 * The bytes go to disk exactly as given — no template literal is allowed to
 * normalise a `\r\n` away, which is the point of half these cases.
 */
async function readPage(raw: string): Promise<DocFile> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wave-docs-matter-'));
  dirs.push(dir);
  await writeFile(path.join(dir, 'page.md'), raw, 'utf8');

  const source = createDocsSource({ contentDir: dir, onBrokenLinks: 'ignore' });
  const file = await source.find(['page']);
  if (file === undefined) throw new Error('the page did not resolve');
  return file;
}

describe('frontmatter parsing', () => {
  it('reads an ordinary block', async () => {
    const page = await readPage('---\ntitle: Auth\n---\n\nBody.\n');

    expect(page.frontmatter.title).toBe('Auth');
    expect(page.content).toBe('\nBody.\n');
  });

  it('survives a UTF-8 BOM', async () => {
    /*
     * Editors on Windows write one, and a parser that does not strip it sees
     * `﻿---` — not a delimiter — so the entire block becomes body text
     * and the page has no title at all.
     */
    const page = await readPage('﻿---\ntitle: Auth\n---\n\nBody.\n');

    expect(page.frontmatter.title).toBe('Auth');
    expect(page.content.trim()).toBe('Body.');
  });

  it('survives CRLF line endings', async () => {
    const page = await readPage('---\r\ntitle: Auth\r\n---\r\n\r\nBody.\r\n');

    expect(page.frontmatter.title).toBe('Auth');
    expect(page.content).toContain('Body.');
  });

  it('keeps a --- inside the body out of the block', async () => {
    /*
     * A thematic break in prose, or a YAML sample in a fence. Read as a
     * delimiter it silently truncates the page at the horizontal rule.
     */
    const page = await readPage(
      '---\ntitle: Auth\n---\n\nBefore.\n\n---\n\nAfter.\n',
    );

    expect(page.frontmatter.title).toBe('Auth');
    expect(page.content).toContain('Before.');
    expect(page.content).toContain('After.');
    expect(page.content).toContain('---');
  });

  it('rejects a file with no block at all', async () => {
    // `title` is required, so a page with no frontmatter is a build failure
    // naming the file rather than a page titled `undefined`.
    await expect(readPage('# Just a heading\n')).rejects.toMatchObject({
      code: 'invalid-frontmatter',
    });
  });

  it('rejects an empty block', async () => {
    await expect(readPage('---\n---\n\nBody.\n')).rejects.toMatchObject({
      code: 'invalid-frontmatter',
    });
  });

  it('rejects a whitespace-only block', async () => {
    await expect(readPage('---\n   \n---\n\nBody.\n')).rejects.toMatchObject({
      code: 'invalid-frontmatter',
    });
  });

  it('rejects a block that is a scalar rather than a mapping', async () => {
    // `--- \n just a string \n ---` parses as valid YAML and is not an object;
    // reading `.title` off it yields `undefined` with nothing to report.
    await expect(
      readPage('---\njust a string\n---\n\nBody.\n'),
    ).rejects.toMatchObject({ code: 'invalid-frontmatter' });
  });

  it('names the file and keeps the YAML error when the block is malformed', async () => {
    /*
     * The error message is something this package is graded on. js-yaml's own
     * error carries the line and column inside the block, which the flattened
     * `reason` drops — so it is kept as `cause` for anyone who unwraps.
     */
    const failure = await readPage('---\ntitle: "unterminated\n---\n\nB.\n')
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('page.md');
    expect((failure as { code?: string }).code).toBe('invalid-frontmatter');
    expect((failure as { cause?: unknown }).cause).toBeInstanceOf(Error);
  });

  it('ends the block at the first closing fence, whatever follows', async () => {
    /*
     * ⚠️ THE FIXTURE WAS THE ORDINARY CASE. This test claimed to cover "a second
     * document in the same YAML stream" against
     * `'---\ntitle: Auth\n---\n\nBody.\n'` — a plain single-document block,
     * byte-identical in shape to the happy path two tests up. It asserted
     * nothing the rest of the file did not already.
     *
     * What is actually at stake: a `---` after the closing fence must be body,
     * not more frontmatter. A parser that consumed the YAML *stream* rather
     * than the fenced block would swallow the reader's horizontal rule and the
     * prose behind it.
     */
    const page = await readPage(
      '---\ntitle: Auth\n---\n\nIntro.\n\n---\n\nAfter the rule.\n',
    );

    expect(page.frontmatter.title).toBe('Auth');
    expect(page.content).toContain('Intro.');
    expect(page.content).toContain('After the rule.');
    // The separator itself survives into the body, so it renders as the
    // thematic break the author typed.
    expect(page.content).toContain('---');
    // And it did not become data.
    expect(Object.keys(page.frontmatter)).toEqual(['title']);
  });

  it('leaves a --- inside a quoted value alone', async () => {
    // The fence-matching is line-based, so a value that merely contains the
    // three characters must not truncate the block. `description` is the field
    // most likely to hold one.
    const page = await readPage(
      '---\ntitle: Auth\ndescription: "before --- after"\n---\n\nBody.\n',
    );

    expect(page.frontmatter.title).toBe('Auth');
    expect(page.frontmatter.description).toBe('before --- after');
    expect(page.content).toContain('Body.');
  });
});
