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
the documented defaults. This paragraph exists to be longer than the default
excerpt budget so that truncation has something real to cut, and it keeps
going for a while yet so that the cut lands somewhere in the middle of a
sentence rather than politely at its end.

| Option    | Default              |
| --------- | -------------------- |
| `baseUrl` | `https://api.wave.so` |
| `timeout` | `10000`              |

### Options

A second heading named "Options" so `rehype-slug` has to disambiguate it.
