import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// @ts-expect-error plain JS build script without type declarations
import { renderDocs } from '../scripts/generate-docs.mjs';
import * as api from '../src/index.js';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

describe('docs', () => {
  it('generated operation tables are up to date (run `npm run docs`)', () => {
    for (const [file, expected] of Object.entries(renderDocs() as Record<string, string>)) {
      expect(read(file), file).toBe(expected);
    }
  });

  it('the API reference mentions every runtime export', () => {
    const reference = read('docs/api.md');
    for (const name of Object.keys(api)) {
      expect(reference).toContain(name);
    }
  });

  it('the API reference lists every constant value', () => {
    const reference = read('docs/api.md');
    for (const map of [api.HttpMethod, api.SignAlgorithm, api.SubResource, api.XiaomiHeader]) {
      for (const value of Object.values(map)) {
        expect(reference).toContain(value);
      }
    }
  });

  it('relative links between docs resolve', () => {
    for (const file of [
      'README.md',
      'docs/README.md',
      'docs/api.md',
      'docs/operations.md',
      'docs/presign.md',
    ]) {
      const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
      for (const [, target] of read(file).matchAll(/\]\((\.{1,2}\/[^)#]+)(?:#[^)]*)?\)/g)) {
        expect(() => read(dir + target), `${file} -> ${target}`).not.toThrow();
      }
    }
  });

  it('anchors linked from the docs exist', () => {
    const anchors = (file: string) =>
      new Set(
        [...read(file).matchAll(/^#+ (.+)$/gm)].map(([, h]) =>
          h
            .toLowerCase()
            .replace(/[^\w\- ]/g, '')
            .replace(/ /g, '-'),
        ),
      );
    for (const file of ['docs/api.md', 'docs/presign.md', 'docs/operations.md', 'README.md']) {
      for (const [, target, anchor] of read(file).matchAll(
        /\]\(((?:\.{1,2}\/)?[\w./-]*)#([\w-]+)\)/g,
      )) {
        const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
        const linked = target === '' ? file : dir + target;
        expect(anchors(linked), `${file} -> ${linked}#${anchor}`).toContain(anchor);
      }
    }
  });
});
