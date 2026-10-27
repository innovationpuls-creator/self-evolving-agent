import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const { origin, token } = JSON.parse(await readFile(new URL('../.runtime/connection.json', import.meta.url), 'utf8'));
// Same hash-token bootstrap as the formal Web. Never print the token.
spawn('open', [`${origin}/#token=${encodeURIComponent(token)}`], { stdio: 'ignore' });
