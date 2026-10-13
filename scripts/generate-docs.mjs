#!/usr/bin/env node
/**
 * Regenerates the operation tables in docs/operations.md and docs/presign.md
 * from test/fixtures/operations.json (the requests captured from the official
 * Java SDK client). test/docs.test.ts fails when the docs are out of date.
 *
 * Usage: npm run docs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const START = '<!-- generated:start -->';
const END = '<!-- generated:end -->';

/** Human-readable description and request body of each operation. */
const DESCRIPTIONS = {
  listBuckets: ['List buckets you own', '—'],
  listAuthorizedBuckets: ['List buckets you are authorized to access', '—'],
  createBucket: ['Create a bucket', 'JSON (`{}`)'],
  deleteBucket: ['Delete a bucket', '—'],
  getBucketInfo: ['Get bucket information', '—'],
  doesBucketExist: ['Check whether a bucket exists', '—'],
  listObjects: ['List objects (`prefix`, `delimiter`, `marker`, `maxKeys`, …)', '—'],
  listVersions: ['List object versions', '—'],
  listTrashObjects: ['List objects in the trash (the bucket name goes in `prefix`)', '—'],
  getBucketAcl: ['Get the bucket ACL', '—'],
  setBucketAcl: ['Set the bucket ACL', 'ACL JSON'],
  deleteBucketAcl: ['Remove grants from the bucket ACL', 'ACL JSON'],
  getBucketQuota: ['Get the bucket quota', '—'],
  setBucketQuota: ['Set the bucket quota', 'Quota JSON'],
  deleteObjects: ['Delete multiple objects', 'JSON array of object names'],
  getAccessLogConfig: ['Get the access log configuration', '—'],
  updateAccessLogConfig: ['Update the access log configuration', 'JSON'],
  getLifecycleConfig: ['Get the lifecycle configuration', '—'],
  updateLifecycleConfig: ['Update the lifecycle configuration', 'JSON'],
  getBucketCORSConfiguration: ['Get the CORS configuration', '—'],
  updateBucketCORSConfiguration: ['Update the CORS configuration', 'JSON'],
  putDomainMapping: ['Bind a custom domain', '—'],
  listDomainMappings: ['List custom domains', '—'],
  deleteDomainMapping: ['Unbind a custom domain', '—'],
  setMirror: ['Set the mirror (back-to-origin) URL', 'Origin URL'],
  getMirror: ['Get the mirror URL', '—'],
  deleteMirror: ['Delete the mirror URL', '—'],
  getTimestampAntiStealingLinkConfig: ['Get the anti-hotlinking configuration', '—'],
  updateTimestampAntiStealingLinkConfig: ['Update the anti-hotlinking configuration', 'JSON'],
  deleteTimestampAntiStealingLinkConfig: ['Delete the anti-hotlinking configuration', '—'],
  migrateBucket: ['Move a bucket to another org / team', '—'],
  putObject: ['Upload an object', 'File bytes'],
  postObject: ['Upload an object with a server-generated name', 'File bytes'],
  getObject: ['Download an object', '—'],
  getObjectRange: ['Download part of an object (`range` header)', '—'],
  getObjectVersion: ['Download a specific object version', '—'],
  doesObjectExist: ['Check whether an object exists', '—'],
  deleteObject: ['Delete an object', '—'],
  getObjectMetadata: ['Get object metadata', '—'],
  setObjectMetadata: ['Replace object metadata', 'JSON (`{ rawMeta }`)'],
  getObjectAcl: ['Get the object ACL', '—'],
  setObjectAcl: ['Set the object ACL', 'ACL JSON'],
  deleteObjectAcl: ['Remove grants from the object ACL', 'ACL JSON'],
  setPublic: ['Make an object public (an ACL grant for `ALL_USERS`)', 'ACL JSON'],
  copyObject: [
    'Copy an object (the request targets the destination)',
    'JSON (`{ srcBucketName, srcObjectName }`)',
  ],
  renameObject: ['Rename an object', '—'],
  restoreObject: ['Restore an object from the trash', '—'],
  restoreArchivedObject: ['Restore an archived object', '—'],
  prefetchObject: ['Prefetch an object into the CDN', '—'],
  refreshObject: ['Refresh the CDN cache of an object', '—'],
  getThumbnail: ['Get an image thumbnail', '—'],
  cropImage: ['Crop an image in place', '—'],
  getThirdPartyObject: ['Get a third-party object', '—'],
  initMultipartUpload: ['Start a multipart upload (returns `uploadId`)', '—'],
  uploadPart: ['Upload one part', 'Part bytes'],
  completeMultipartUpload: ['Complete a multipart upload', 'JSON (`{ uploadPartResultList }`)'],
  abortMultipartUpload: ['Abort a multipart upload', '—'],
};

const GROUPS = [
  ['service', 'Service'],
  ['bucket', 'Buckets'],
  ['object', 'Objects'],
  ['multipart', 'Multipart upload'],
];

/** Renders a value as a compact JavaScript literal. */
function js(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(js).join(', ') + ']';
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return '{}';
    }
    const body = entries
      .map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`}: ${js(v)}`)
      .join(', ');
    return `{ ${body} }`;
  }
  return typeof value === 'string' ? `'${value}'` : String(value);
}

const describe = (op) => {
  const d = DESCRIPTIONS[op.javaMethod];
  if (d === undefined) {
    throw new Error(`missing description for ${op.javaMethod}`);
  }
  return d;
};
// Escape the pipe character, which would otherwise split a table cell.
const code = (s) => '`' + s.replaceAll('|', '\\|') + '`';

function operationsTable(ops) {
  const out = [];
  for (const [group, title] of GROUPS) {
    out.push(`### ${title}`, '');
    out.push('| Operation | Java SDK | HTTP request | `signRequest` input | Body | Pre-sign |');
    out.push('| --- | --- | --- | --- | --- | :---: |');
    for (const op of ops.filter((o) => o.group === group)) {
      const [description, body] = describe(op);
      out.push(
        `| ${description} | ${code(op.javaMethod)} | ${code(`${op.input.method} ${op.javaPath}`)} ` +
          `| ${code(js(op.input))} | ${body} | ${op.presignable ? '✅' : '—'} |`,
      );
    }
    out.push('');
  }
  return out.join('\n');
}

function presignTable(ops) {
  const out = [
    '| Operation | Java SDK | `presign` input | The client must send |',
    '| --- | --- | --- | --- |',
  ];
  for (const op of ops.filter((o) => o.presignable)) {
    const [description, body] = describe(op);
    const headers = Object.entries(op.input.headers ?? {});
    let send = headers.map(([k, v]) => code(`${k}: ${v}`)).join(', ') || 'no extra headers';
    if (body !== '—') {
      send += `; body: ${body}`;
    }
    out.push(`| ${description} | ${code(op.javaMethod)} | ${code(js(op.input))} | ${send} |`);
  }
  return out.join('\n');
}

function replaceGenerated(markdown, content) {
  const start = markdown.indexOf(START);
  const end = markdown.indexOf(END);
  if (start < 0 || end < start) {
    throw new Error('generated markers not found');
  }
  return markdown.slice(0, start + START.length) + '\n' + content + '\n' + markdown.slice(end);
}

/** Returns `{ [docPath]: expectedContent }` for every generated document. */
export function renderDocs() {
  const ops = JSON.parse(readFileSync(new URL('test/fixtures/operations.json', root), 'utf8'));
  const missing = Object.keys(DESCRIPTIONS).filter((k) => !ops.some((o) => o.javaMethod === k));
  if (missing.length > 0) {
    throw new Error(`descriptions without operations: ${missing.join(', ')}`);
  }
  const result = {};
  for (const [file, render] of [
    ['docs/operations.md', operationsTable],
    ['docs/presign.md', presignTable],
  ]) {
    const current = readFileSync(new URL(file, root), 'utf8');
    result[file] = replaceGenerated(current, render(ops));
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [file, content] of Object.entries(renderDocs())) {
    writeFileSync(new URL(file, root), content);
    console.log(`updated ${file}`);
  }
}
