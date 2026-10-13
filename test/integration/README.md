# Live integration tests

Requests to a **real FDS bucket**, through the built `dist/` rather than `src/`.
`vite.config.ts` defines a `unit` project, which `npm test` runs and which
excludes this directory, so the offline suite stays hermetic and a stray `FDS_*`
in the environment can never upload anything. Run the live project deliberately:

```bash
export FDS_ACCESS_ID='…'
export FDS_ACCESS_SECRET='…'
export FDS_BUCKET='…'                            # must be writable by the key
export FDS_ENDPOINT='cnbj1.fds.api.xiaomi.com'   # or FDS_REGION / FDS_BASE_URI
export FDS_UPLOAD_FILE="$PWD/README.md"          # optional

npm run test:integration
```

That command builds `dist/` first and then runs
`vitest run --project integration`. A one-liner works too, since npm forwards the
environment:

```bash
FDS_ACCESS_ID=… FDS_ACCESS_SECRET=… FDS_BUCKET=… FDS_ENDPOINT=cnbj1.fds.api.xiaomi.com npm run test:integration
```

## Environment

| Variable            |                    | Meaning                                                                                                       |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `FDS_ACCESS_ID`     | required           | Access key id.                                                                                                |
| `FDS_ACCESS_SECRET` | required           | Secret access key.                                                                                            |
| `FDS_BUCKET`        | required           | Bucket to write to.                                                                                           |
| `FDS_ENDPOINT`      | one of these three | Service host, e.g. `cnbj1.fds.api.xiaomi.com`. The CDN host is derived from it.                               |
| `FDS_REGION`        |                    | Region name; the endpoint becomes `{region}.fds.api.xiaomi.com`.                                              |
| `FDS_BASE_URI`      |                    | Explicit service base URL (`http(s)://host[:port]/`), e.g. a local mock. Takes precedence over the two above. |
| `FDS_CDN_BASE_URI`  | optional           | CDN base URL; defaults to `cdn.{region}.fds.api.mi-img.com`.                                                  |
| `FDS_UPLOAD_FILE`   | optional           | Local file to upload; a temporary file is used otherwise.                                                     |

## What it does

The cases, in order: upload the local file, read it back over the service
endpoint (byte-for-byte, plus `HEAD` `content-length`), read the `?metadata`
sub-resource, list with unsigned query parameters, upload through a pre-signed
URL, complete and abort a multipart upload, download over the CDN, then delete
the object. The file header of `live.test.ts` maps each case to the request
shape it is there to prove.

Payloads are deliberately tiny (a single 64 KiB multipart part): a part that is
also the last part is exempt from any minimum-part-size rule, so a smaller
payload proves the same signatures. The whole suite is a handful of round trips
and the config caps each case at 30 s.

## Safety

- Point it at a scratch bucket. It creates and deletes objects; it never
  changes bucket-level state (ACL, quota, lifecycle, CORS, access log) or any of
  the destructive operations, by design — see the file header of
  `live.test.ts` for why that ceiling is deliberate.
- Everything lands under `integration/<timestamp>-…` and is deleted afterwards,
  including a best-effort sweep in `afterAll` when a case fails midway.
- Object names are unique per run, so a re-run never reads a stale object and
  never hits a warm CDN entry.
- Do not leave bare `npx vitest` (or `vitest watch`) running with `FDS_*`
  exported: it starts every project, so each file change would re-run this
  suite against the real bucket. Watch the unit project explicitly with
  `npx vitest watch --project unit`.

## Reading the results

- Without the required variables the whole suite is **skipped**, and the suite
  name lists exactly which variables are missing.
- The CDN case is skipped on its own when no CDN host applies, e.g. for a bare
  `FDS_BASE_URI`; its name says so.
- Every unexpected response is reported with the FDS error body, not just the
  status, so a `403 Signature Does Not Match` next to the request tells you
  whether the credentials, the bucket or the signature is at fault.
- If the CDN case fails while the service-endpoint cases pass, the bucket
  likely has CDN / outside access disabled, or the object has not been
  refreshed yet (`refreshObject`).
