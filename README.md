# uSync Action

A GitHub Action that runs [uSync](https://github.com/KevinJump/uSync) on a site
you have just deployed and reports what happened: did the import succeed, which
items failed, is anything still pending, and can the site still reach the uSync
Publisher servers it is connected to.

It talks to the deployed site over the Umbraco Management API only. There is no
.NET dependency and no CLI to install.

## What it does

One pipeline, always in this order. Flags turn stages on or off.

1. Wait for the site to be ready.
2. Import.
3. Report (confirms nothing is left pending).
4. Optionally rebuild the published cache and indexes.
5. Optionally export, and download the export as an artifact.
6. Check the Publisher connections.
7. Write one job summary covering every stage.

## Quick start

```yaml
- uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.UMBRACO_CLIENT_ID }}
    client-secret: ${{ secrets.UMBRACO_CLIENT_SECRET }}
```

That waits for the site, imports, reports, and checks connections.

## Stages

| #   | Stage            | Controlled by                                             | Default                        | What it does                                                                                                                                                        |
| --- | ---------------- | --------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Wait             | `wait`, `wait-timeout-minutes`, `wait-for-startup-import` | on, 10 minutes, on             | Polls until the site runs, checks the credentials and permissions, waits for a startup or first-boot import, and waits for other uSync operations to finish.        |
| 2   | Import           | `import`, `force`, `set`, `group`                         | on, false, site default, `all` | Runs the import. Failed items mark the run failed, but the pipeline carries on so the report still runs.                                                            |
| 3   | Report           | `report`, `fail-on-changes`                               | on, false                      | After an import, confirms nothing is pending. With `import: false` it is a dry run listing what would change. `fail-on-changes: true` fails if anything is pending. |
| 4   | Rebuild cache    | `rebuild-cache`                                           | off                            | Rebuilds the published cache and waits for it to finish.                                                                                                            |
| 5   | Rebuild indexes  | `rebuild-indexes`                                         | empty (off)                    | Rebuilds each named index. A missing index is a warning.                                                                                                            |
| 6   | Export           | `export`, `export-clean`, `download-export`               | off, false, false              | Runs an export. With `download-export` it downloads the zip and uploads it as an artifact.                                                                          |
| 7   | Connection check | `check-connections`, `fail-on-connection-error`           | on, false                      | Asks the site to check its Publisher servers. Anything other than `Success` is a warning, or a failure with `fail-on-connection-error: true`.                       |

Failure policy:

- If the wait stage fails (site never ready, bad credentials, missing
  permission) the run stops, because nothing else can work.
- Any other stage that fails is recorded and the remaining stages still run. The
  action fails at the end and lists the failed stages.
- `download-export: true` without `export` turns `export` on and logs a notice.
- If every stage including `wait` is off, the action fails with "Nothing to do".

## Modes

Modes are flag combinations, not separate commands.

| Mode                    | Flags                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| Deploy (default)        | none                                                               |
| Report only / dry run   | `import: false`                                                    |
| Drift gate              | `import: false`, `fail-on-changes: true`                           |
| Wait only               | `import: false`, `report: false`, `check-connections: false`       |
| Connection health check | `import: false`, `report: false`, `fail-on-connection-error: true` |

## Inputs

| Input                      | Required | Default        | Description                                                                                         |
| -------------------------- | -------- | -------------- | --------------------------------------------------------------------------------------------------- |
| `server`                   | yes      |                | Base URL of the deployed site, for example `https://example.com`. A virtual directory path is kept. |
| `client-id`                | yes      |                | Client ID of the Umbraco API user. Must start with `umbraco-back-office-`.                          |
| `client-secret`            | yes      |                | Client secret of the API user. Masked in logs.                                                      |
| `wait`                     | no       | `true`         | Run the wait stage.                                                                                 |
| `wait-timeout-minutes`     | no       | `10`           | How long to wait for the site to be ready.                                                          |
| `wait-for-startup-import`  | no       | `true`         | Wait for a startup or first-boot import to finish (uSync 17.6.3+, skipped otherwise).               |
| `import`                   | no       | `true`         | Run the import.                                                                                     |
| `force`                    | no       | `false`        | Force the import even for unchanged items.                                                          |
| `set`                      | no       | empty          | uSync set. Empty uses the site's default set.                                                       |
| `group`                    | no       | `all`          | Handler group to process.                                                                           |
| `report`                   | no       | `true`         | Run the report.                                                                                     |
| `fail-on-changes`          | no       | `false`        | Fail if the report finds pending changes.                                                           |
| `rebuild-cache`            | no       | `false`        | Rebuild the published cache.                                                                        |
| `rebuild-indexes`          | no       | empty          | Index names to rebuild, separated by commas or new lines. Empty is off.                             |
| `export`                   | no       | `false`        | Run an export.                                                                                      |
| `export-clean`             | no       | `false`        | Clean the export folder first.                                                                      |
| `download-export`          | no       | `false`        | Download the export zip and upload it as an artifact. Needs an admin API user.                      |
| `export-artifact-name`     | no       | `usync-export` | Artifact name. Letters, numbers, `.`, `_` and `-` only.                                             |
| `check-connections`        | no       | `true`         | Check the site's Publisher servers (needs uSync.Complete).                                          |
| `fail-on-connection-error` | no       | `false`        | Fail instead of warn when a connected server is not `Success`.                                      |
| `timeout-minutes`          | no       | `30`           | Maximum time for one long operation (import, report, export, background polling, cache rebuild).    |
| `request-timeout-seconds`  | no       | `60`           | Timeout for a single HTTP request. 429, 502, 503, 504 and network errors are retried with backoff.  |

## Outputs

| Output              | Description                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `success`           | `true` if every stage that ran succeeded.                                                                       |
| `stages`            | JSON array of `{id, status, summary}` per stage; status is one of: `success`, `warning`, `failed` or `skipped`. |
| `imported-changes`  | Number of items changed by the import.                                                                          |
| `import-errors`     | Number of items that failed to import.                                                                          |
| `pending-changes`   | Number of changes still pending according to the report.                                                        |
| `warnings`          | Number of warnings raised by uSync items.                                                                       |
| `umbraco-version`   | Umbraco version of the site.                                                                                    |
| `usync-version`     | uSync version of the site, if detected.                                                                         |
| `export-artifact`   | Name of the artifact holding the downloaded export, if any.                                                     |
| `connections`       | JSON array `[{alias, name, url, status}]` from the connection check.                                            |
| `connection-errors` | Number of connected servers that did not report `Success`.                                                      |
| `results-file`      | Path to a JSON file in `RUNNER_TEMP` with the full results of every stage.                                      |

## Recipes

### Deploy to an empty database

uSync can seed a new database during the first boot. Configure that on the site,
not in the action. With Umbraco unattended install and
`uSync:Settings:ImportOnFirstBoot` set to `true`, the site imports your uSync
files while it starts for the first time.

```json
{
  "Umbraco": {
    "CMS": {
      "Unattended": {
        "InstallUnattended": true,
        "UnattendedUserName": "Admin",
        "UnattendedUserEmail": "admin@example.com",
        "UnattendedUserPassword": "set-this-from-a-secret"
      }
    }
  },
  "uSync": {
    "Settings": {
      "ImportOnFirstBoot": true
    }
  }
}
```

Then run the action after the deploy. It waits for the site to reach `Run`,
waits for the first-boot import to finish (uSync 17.6.3+), imports again
(usually a quick no-op) and reports.

```yaml
- uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.UMBRACO_CLIENT_ID }}
    client-secret: ${{ secrets.UMBRACO_CLIENT_SECRET }}
    wait-timeout-minutes: 20
```

The API user must exist before the action can sign in. Create it as part of your
deploy or seed it with your own tooling.

### Report only / drift gate

Dry run, listing what would change:

```yaml
- uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.UMBRACO_CLIENT_ID }}
    client-secret: ${{ secrets.UMBRACO_CLIENT_SECRET }}
    import: false
```

Fail the build if the site has drifted from the uSync files:

```yaml
- uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.UMBRACO_CLIENT_ID }}
    client-secret: ${{ secrets.UMBRACO_CLIENT_SECRET }}
    import: false
    fail-on-changes: true
```

### Scheduled connection health check

```yaml
on:
  schedule:
    - cron: '0 6 * * 1-5'

jobs:
  connections:
    runs-on: ubuntu-latest
    steps:
      - uses: mattou07/actions-uSync-cli@v1
        with:
          server: ${{ vars.UMBRACO_URL }}
          client-id: ${{ secrets.UMBRACO_CLIENT_ID }}
          client-secret: ${{ secrets.UMBRACO_CLIENT_SECRET }}
          import: false
          report: false
          fail-on-connection-error: true
```

### Export and download an artifact

```yaml
- uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.UMBRACO_CLIENT_ID }}
    client-secret: ${{ secrets.UMBRACO_ADMIN_CLIENT_SECRET }}
    import: false
    report: false
    check-connections: false
    export: true
    download-export: true
    export-artifact-name: usync-export
```

The zip is uploaded as the `usync-export` artifact. The API user needs an admin
group for the download.

### Using outputs in later steps

```yaml
- uses: mattou07/actions-uSync-cli@v1
  id: usync
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.UMBRACO_CLIENT_ID }}
    client-secret: ${{ secrets.UMBRACO_CLIENT_SECRET }}

- name: Show results
  if: always()
  run: |
    echo "Imported: ${{ steps.usync.outputs.imported-changes }}"
    echo "Errors: ${{ steps.usync.outputs.import-errors }}"
    echo "Pending: ${{ steps.usync.outputs.pending-changes }}"
    echo "Failing connections: ${{ steps.usync.outputs.connection-errors }}"
```

Use `if: always()` to read the outputs even when the action failed. The
`connections` and `stages` outputs are JSON, so pass them through an `env:`
variable and parse them with `jq` rather than interpolating them into a script.

## API user setup

The action signs in with the OAuth client credentials flow of an Umbraco API
user. It requests a fresh token as needed, so there is no token to mint or
expire.

1. In the backoffice go to Users and create an API user.
2. The client ID must start with `umbraco-back-office-`, for example
   `umbraco-back-office-github`.
3. Put the user in a group with access to the Settings section (or the uSync
   section).
4. Store the client ID and secret as GitHub secrets.

Extra requirements:

- `download-export` needs a group with admin access.
- The connection check needs uSync.Complete (uSync Publisher) on the site, and
  the user needs access to it.

## How connection checks work

The deployed site checks its own uSync Publisher servers. The action calls
`GET /umbraco/usync/api/v1/Publisher/GetAllServers` on your site to list the
servers, drops the site's own entry (`GetCurrent`), and then calls
`GET /umbraco/usync/api/v1/Publisher/CheckServer?server={alias}` for each one.
The site contacts the other server and returns a status such as `Success`,
`Unreachable`, `Unauthorized` or `ApiMismatch`. GitHub never contacts the other
environments, and the URLs returned are displayed but never fetched.

If uSync.Complete is not installed (404) or no servers are configured, the stage
is skipped with a notice.

## Version support

| uSync | Support                                                                                                  |
| ----- | -------------------------------------------------------------------------------------------------------- |
| 18    | Full.                                                                                                    |
| 17    | Full. `StartupStatus`, background mode and `Running` need 17.6.3 or later and are skipped on older 17.x. |
| 16    | Works. `StartupStatus`, background processing and `Running` are skipped.                                 |

When an optional endpoint returns 404 the action carries on without that
feature.

## Load balancing

In the default (normal) processing mode, uSync keeps the state of each step in
the memory of the server that handled it. Behind a load balancer without session
affinity, consecutive steps can hit different servers and fail. Either set
`uSync:Settings:ProcessingMode` to `Background` on the site (uSync 17.6.3+), or
enable session affinity for the action's requests.

## Security

- `server` must be https. http is allowed only for `localhost`, `127.0.0.1`,
  `[::1]` and `*.localhost`. Credentials in the URL, query strings and fragments
  are rejected.
- `client-secret` and every access token are masked in logs. Tokens are never
  written to logs, and error bodies are capped and redacted.
- The action only contacts the `server` you give it.
- Text from the server (item names, messages, server names) is escaped before it
  reaches logs or the job summary.
- The action runs no shell commands.

## Local development

```bash
npm ci
cp .env.example .env     # fill in INPUT_SERVER, INPUT_CLIENT-ID, INPUT_CLIENT-SECRET
npm run local-action     # runs src/main.ts with the .env
npm run ci-test          # tests, 100% coverage enforced
npm run bundle           # format and rebuild dist/
```

`local-action` exits 0 even when the action fails, so look for `::error::`
lines. Use a site meant for testing: the import and export stages change real
data.
