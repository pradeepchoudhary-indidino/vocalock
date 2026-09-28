#!/usr/bin/env node
/**
 * Fail if a className used in the app has no rule in theme.css.
 *
 * This exists because the opposite of a missing style is not an error anywhere:
 * React renders the element, the build succeeds, and the screen just looks
 * broken. It has already happened twice — both times a block was sliced out of
 * theme.css by an edit that replaced the section above it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync('src/theme.css', 'utf8');
const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

const missing = new Map();
for (const file of walk('src')) {
  const text = readFileSync(file, 'utf8');
  const re = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g;
  for (const m of text.matchAll(re)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    for (const cls of raw.split(/\s+/)) {
      // Template literals leave a bare modifier prefix behind; skip those.
      if (!cls || cls.endsWith('--') || defined.has(cls)) continue;
      if (!missing.has(cls)) missing.set(cls, new Set());
      missing.get(cls).add(file);
    }
  }
}

if (missing.size === 0) {
  console.log(`classes: all resolve (${defined.size} defined)`);
  process.exit(0);
}

console.error(`\n${missing.size} class(es) used with no rule in theme.css:\n`);
for (const [cls, files] of [...missing].sort()) {
  console.error(`  .${cls}  <-  ${[...files].join(', ')}`);
}
console.error('');
process.exit(1);
