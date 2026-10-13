#!/usr/bin/env node
/**
 * Cuts a release: bumps (or keeps) the version in package.json, commits, tags,
 * pushes, and opens a GitHub Release.
 *
 * Publishing is deliberately not done here: `.github/workflows/release.yml`
 * runs on `release: published` and performs the verified `npm publish`.
 *
 * Usage: npm run release -- <patch|minor|major|current|<version>>
 *
 *   patch|minor|major  bump the version in package.json
 *   <version>          set an explicit version, e.g. 1.0.0
 *   current            no bump: release the version already in package.json.
 *                      Used for the very first release, see below.
 *
 * The first version cannot be published by release.yml: npm only lets a
 * trusted publisher (OIDC) be configured for a package that already exists
 * (npm/cli#8544). So while the package is not on the registry, `current`
 * publishes it from this machine (`npm publish`, using your `npm login`
 * session) before tagging; release.yml then sees the version on the registry
 * and skips it. Every later release is published by release.yml alone.
 *
 * Runs `npm ci` and `npm run verify` before tagging. Requires a clean working
 * tree on main and an authenticated `gh` CLI.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Runs a command, streaming its output to the terminal. */
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });

/** Runs a command and returns its trimmed stdout. */
const output = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();

const pkg = () => JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** The version currently declared in package.json. */
const currentVersion = () => pkg().version;

/** Versions of this package on the registry; empty when it was never published. */
function publishedVersions() {
  try {
    // stderr is captured, not shown: a 404 is the expected answer before the first release.
    const json = execFileSync('npm', ['view', pkg().name, 'versions', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const versions = JSON.parse(json);
    return Array.isArray(versions) ? versions : [versions];
  } catch (e) {
    if (/E404/.test(String(e.stderr ?? e.message))) {
      return [];
    }
    throw e;
  }
}

const BUMPS = ['patch', 'minor', 'major'];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// No default: picking the bump is a decision (a breaking change on 0.x is a
// minor bump, for instance), not something to fall into by omission.
const mode = process.argv[2];
if (mode !== 'current' && !BUMPS.includes(mode) && !SEMVER.test(mode ?? '')) {
  console.error(`usage: npm run release -- <${BUMPS.join('|')}|current|<version>>`);
  process.exit(1);
}

if (output('git', ['status', '--porcelain']) !== '') {
  console.error('error: the working tree is not clean, commit or stash first');
  process.exit(1);
}
if (output('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') {
  console.error('error: releases must be cut from main');
  process.exit(1);
}

run('git', ['pull', '--ff-only']);

const published = publishedVersions();
// Never published: only `current` can release, by publishing from here.
const bootstrap = published.length === 0;
if (bootstrap && mode !== 'current') {
  console.error(
    `error: ${pkg().name} is not on npm yet, and release.yml cannot publish a new ` +
      'package via OIDC; cut the first release with `npm run release -- current`',
  );
  process.exit(1);
}
if (mode === 'current') {
  const version = currentVersion();
  if (output('git', ['tag', '--list', `v${version}`]) !== '') {
    console.error(`error: tag v${version} already exists, choose a new version`);
    process.exit(1);
  }
  // A published but untagged version is a bootstrap publish whose tagging
  // failed: re-running just tags it. Otherwise only the bootstrap may publish
  // here; release.yml publishes everything else.
  if (!bootstrap && !published.includes(version)) {
    console.error(
      `error: ${version} is not on npm; use patch/minor/major or an explicit version, ` +
        'and release.yml will publish it',
    );
    process.exit(1);
  }
}

// Verify before anything is published or tagged: release.yml would refuse a
// failing build, but only after the tag and the GitHub Release are public.
run('npm', ['ci']);
run('npm', ['run', 'verify']);

if (mode === 'current') {
  if (bootstrap) {
    // Fail fast with npm's own message when not logged in. prepublishOnly is
    // skipped because verify just ran on this exact tree.
    output('npm', ['whoami']);
    run('npm', ['publish', '--ignore-scripts']);
  }
  const version = currentVersion();
  run('git', ['tag', '-a', `v${version}`, '-m', `release v${version}`]);
} else {
  // `npm version` bumps package.json, commits and creates the `vX.Y.Z` tag.
  run('npm', ['version', mode, '-m', 'chore: release v%s']);
}

const tag = `v${currentVersion()}`;
// Pushed separately: after a `current` release main has nothing new to push, so
// `--follow-tags` would silently skip the tag.
run('git', ['push', 'origin', 'main']);
run('git', ['push', 'origin', tag]);
run('gh', ['release', 'create', tag, '--title', tag, '--generate-notes']);

if (mode === 'current') {
  console.log(
    `\n${tag} is on npm and released; release.yml will see it there and skip it.\n` +
      'If not done yet, configure trusted publishing so later releases go through CI:\n' +
      `  npmjs.com → ${pkg().name} → Settings → Trusted publishing → GitHub Actions\n` +
      '  (repository chengww5217/galaxy-fds-signer, workflow release.yml)',
  );
} else {
  console.log(`\n${tag} released — release.yml is now publishing it to npm.`);
}
