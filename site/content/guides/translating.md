---
title: Translating the chrome
description: The twenty-two strings the package renders itself, and why they belong on the route.
---

Every word on a page that is not your markdown comes from this package — the
skip link, the drawer's two buttons, the callout headings, the copy button, the
message announced after a copy. There are twenty-two of them, and every one is
yours to set.

## Where each one is rendered

**They are not all rendered in the same place.** That is the whole reason the
set lives where it does, so it is worth the table.

| Rendered by | Strings | |
| --- | --- | --- |
| The shell — `docs.Layout` | 4 | `nav`, `openNav`, `closeNav`, `skipToContent` |
| The navigation tree — a Client Component | 3 | `expandGroup`, `collapseGroup`, `externalLink` |
| The table of contents — `docs.Page` | 2 | `toc`, `backToTop` |
| The markdown component map | 9 | `table`, the five callout headings, the three YouTube strings |
| A rehype plugin, at build time | 2 | `copyCode`, `copyCodeFrom` |
| A client runtime, after a copy | 2 | `copied`, `copyFailed` |

`externalLink` does double duty. It is the screen-reader suffix on an external
entry in the sidebar — the ones a [`meta.json`](../getting-started/navigation.md)
adds as links — and on every external link in your content. One string, both
places.

## Why the route rather than the layout

**`labels` is an option on `createDocsRoute`**, beside `contentDir` and the rest
of the [configuration](../reference/configuration.md). A layout prop is upstream
of the shell and of the tree the shell renders, and of nothing else. The table
of contents is `docs.Page`'s. The nine content strings are closed over by a
component map built when the route is created. The copy button's two are
substituted into the HTML by a rehype plugin, before React is involved at all.
None of those is downstream of a layout.

`docs.Layout` still takes a `labels` prop, and it overrides the route's key by
key rather than replacing the object — for a site with two shells, or one
section in another language. Naming one string must not cost you the other
twenty-one. [Layout](./layout.md) has that prop in context.

## The whole set

```ts title="lib/docs-pt.ts"
import { createDocsRoute } from '@waveso/docs/next';

export const docs = createDocsRoute({
  contentDir: 'content/docs',
  labels: {
    // The shell
    nav: 'Documentação',
    openNav: 'Abrir navegação',
    closeNav: 'Fechar navegação',
    skipToContent: 'Ir para o conteúdo',
    // The navigation tree — `{title}` is the group's own name
    expandGroup: 'Abrir {title}',
    collapseGroup: 'Fechar {title}',
    externalLink: '(abre num novo separador)',
    // The table of contents
    toc: 'Nesta página',
    backToTop: 'Voltar ao topo',
    // Your content
    table: 'Tabela',
    calloutNote: 'Nota',
    calloutTip: 'Dica',
    calloutImportant: 'Importante',
    calloutWarning: 'Aviso',
    calloutCaution: 'Atenção',
    youtubeTitle: 'Vídeo do YouTube',
    youtubePlay: 'Reproduzir: {title}',
    youtubeHide: 'Esconder: {title}',
    // Code frames
    copyCode: 'Copiar código',
    copyCodeFrom: 'Copiar código de {title}',
    copied: 'Copiado para a área de transferência.',
    copyFailed: 'Falhou. Selecione o código e prima Control ou Command + C.',
  },
});
```

The type is `DocsLabels` and every key on it is optional.

## Per-key fallback

**Each key falls back on its own.** Set `calloutTip` and nothing else and the
tip callouts say yours, while `toc` stays `'On this page'`, `externalLink` stays
`'(opens in a new tab)'` and the copy button stays `'Copy code'`. A partial map
is a partly translated site rather than a broken one, which is what makes it
safe to translate the visible strings first and the accessible names after.

Unset keys cost nothing either. The route splits the object by the runtime that
renders each group, and a group nobody set is passed as nothing at all — so a
site that overrides none of the twenty-two ships the payload it shipped before
the option existed.

Each of the twenty-two is named in `next.test.ts` alongside the test that proves
it reaches the output. A key that is declared, documented and never wired fails
there rather than reading as configuration, which is exactly how the first four
came to be four.

## `{title}` is a placeholder, not a function

Five of the strings carry `{title}`: `expandGroup` and `collapseGroup`, where it
is the group's own name; `youtubePlay` and `youtubeHide`, where it is the
embed's accessible name; and `copyCodeFrom`, where it is the fence's own
`title="…"`.

**It is substituted, not called.** Two of the five cross from a Server Component
into a Client one, where a function cannot go, and `copyCodeFrom` is filled in
by a rehype plugin at build time, where there is no React to call one in. The
second reason outlives both: a translator has to be able to move the name within
the sentence. `'Copiar código de {title}'` puts it last and another language
puts it first, and a callback appended to a fixed prefix — which is what
concatenation is — can only ever put it where the English wanted it.

> [!WARNING]
> A translation that drops `{title}` renders without the name. Substitution
> finds nothing to replace and uses the string as written, so
> `copyCodeFrom: 'Copiar código'` gives every fence on the page one identical
> accessible name — the defect the titled form exists to prevent. Keep the
> placeholder; move it. [Code blocks](./code-blocks.md) covers the two copy
> buttons, and [Markdown](./markdown.md) the callouts and the embeds.

## The search dialog is separate

Its strings travel with the dialog's own props, reachable through
`search={{ … }}` on `docs.Layout`: the trigger, the placeholder, the dialog's
accessible name, five state messages and the live region's plural forms. That
channel already carries `pageSize` and `minQueryLength`, and a second route to
the same component would be two places to look. [Search](./search.md) has the
table.

> [!NOTE]
> Until 0.5.0 these were hardcoded English, under a `labels` prop on
> `docs.Layout` that documented itself as the whole of a site's translatable
> chrome and reached four strings of the twenty-two. A site built the documented
> way shipped `aria-label="On this page"`, a visible `Back to top`,
> `aria-label="Tip"` on every callout and `Copy code` on every fence, in
> English, whatever language it was written in.
