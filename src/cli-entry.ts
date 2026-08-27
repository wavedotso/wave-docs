#!/usr/bin/env node

/**
 * The executable. Thin on purpose: `./cli` is testable and this is not.
 *
 * `process.exit` lives here rather than in `run`, so a test can drive the
 * command without taking the test runner down with it.
 */

import { run } from './cli.js';

process.exitCode = await run(process.argv.slice(2), process.cwd());
