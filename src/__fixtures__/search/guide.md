# Authentication

Wave signs every request with a short-lived token. Call `createClient()` once
and reuse it — the client refreshes tokens in the background.

## Installation

Install the package with your package manager of choice, then create a client.

```ts
import { createClient } from '@waveso/sdk';

const client = createClient({
  token: process.env.WAVE_TOKEN,
  baseUrl: 'https://api.wave.so',
});
```

### Options

The `baseUrl` option overrides the API host, which is what you want when
running against a local stack.

## Configuration

Configuration is resolved in three passes: explicit options passed to
`createClient` win over environment variables, environment variables win over
the values found in `wave.config.json`, and anything still unset falls back to
the documented defaults. This paragraph runs well past three hundred characters
on purpose: the prose that used to be cut off here is exactly what a reader
searching for a phrase deep inside a long section has to be able to find, so
the words after this point must reach the index intact.

| Option    | Default              |
| --------- | -------------------- |
| `baseUrl` | `https://api.wave.so` |
| `timeout` | `10000`              |

### Options

A second heading named "Options" so `rehype-slug` has to disambiguate it.

> [!NOTE]
> ### Rate limits
>
> Sixty requests a minute, per token. A heading inside a callout is a section
> like any other: the table of contents lists it, so search has to find it.
