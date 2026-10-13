#!/usr/bin/env node
/**
 * Cuts a release: bumps (or keeps) the version in package.json, commits, tags,
 * pushes, and opens a GitHub Release.
 *
 * Publishing is deliberately not done here: `.github/workflows/release.yml`
 * runs on `release: published` and performs the verified `npm publish`.
 *
 * Usage: npm run release -- [patch|minor|major|current|<version>]
 *
 *   patch|minor|major  bump the version in package.json
 *   <version>          set an explicit version, e.g. 1.0.0
 *   current            no bump: tag the version already in package.json, for
 *                      the very first release
 *
 * Requires a clean working tree on main and an authenticated `gh` CLI.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Runs a command, streaming its output to the terminal. */
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });

/** Runs a command and returns its trimmed stdout. */
const output = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();

/** The version currently declared in package.json. */
const currentVersion = () =>
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const BUMPS = ['patch', 'minor', 'major'];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const mode = process.argv[2] ?? 'patch';
if (mode !== 'current' && !BUMPS.includes(mode) && !SEMVER.test(mode)) {
  console.error(`usage: npm run release -- [${BUMPS.join('|')}|current|<version>]`);
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

if (mode === 'current') {
  // First release: publish exactly what package.json already declares.
  const nextTag = `v${currentVersion()}`;
  if (output('git', ['tag', '--list', nextTag]) !== '') {
    console.error(`error: tag ${nextTag} already exists, choose a new version`);
    process.exit(1);
  }
  run('git', ['tag', '-a', nextTag, '-m', `release ${nextTag}`]);
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

console.log(`\n${tag} released — release.yml is now publishing it to npm.`);
