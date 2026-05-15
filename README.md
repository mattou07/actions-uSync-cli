# uSync CLI GitHub Action

[![GitHub Super-Linter](https://github.com/mattou07/actions-uSync-cli/actions/workflows/linter.yml/badge.svg)](https://github.com/marketplace/actions/super-linter)
![CI](https://github.com/mattou07/actions-uSync-cli/actions/workflows/ci.yml/badge.svg)
[![Check dist/](https://github.com/mattou07/actions-uSync-cli/actions/workflows/check-dist.yml/badge.svg)](https://github.com/mattou07/actions-uSync-cli/actions/workflows/check-dist.yml)
[![CodeQL](https://github.com/mattou07/actions-uSync-cli/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/mattou07/actions-uSync-cli/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

A single GitHub Action that runs uSync commands against your Umbraco instance
using the Umbraco Management API. Common commands (`usync-ping`,
`indexer-rebuild`) are executed as direct HTTP calls.

## Prerequisites

- An API user configured in Umbraco with a client ID and secret (see
  [API user setup](#api-user-setup))
- uSync installed on the target Umbraco site
- .NET SDK on the runner **only if** you use CLI-based commands such as
  `usync-import` or `usync-export` (add `actions/setup-dotnet` if your runner
  doesn't have it)

## Usage

```yaml
- uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.USYNC_CLIENT_ID }}
    secret: ${{ secrets.USYNC_SECRET }}
    command: usync-import
```

The `server` input accepts a bare hostname (`my-site.azurewebsites.net`) or a
full URL — `https://` is added automatically if no protocol is present.

## Inputs

| Input             | Description                                          | Required | Default  |
| ----------------- | ---------------------------------------------------- | -------- | -------- |
| `server`          | URL or hostname of the Umbraco server                | ✅       | -        |
| `client-id`       | OAuth2 client ID for the API user                    | ✅       | -        |
| `secret`          | OAuth2 client secret for the API user                | ✅       | -        |
| `command`         | uSync CLI command to run (see [Commands](#commands)) | ✅       | -        |
| `index-name`      | Comma-separated index name(s) for `indexer-rebuild`  | ❌       | `""`     |
| `usync-version`   | Version of uSync CLI to install, or `latest`         | ❌       | `latest` |
| `additional-args` | Extra arguments appended to CLI-based commands       | ❌       | `""`     |

## Outputs

| Output          | Description                                           |
| --------------- | ----------------------------------------------------- |
| `success`       | `true` if the command completed without errors        |
| `exit-code`     | Exit code (`0` = success, `1` = failure)              |
| `output`        | Combined stdout/stderr for CLI-based commands         |
| `index-results` | JSON array of per-index results for `indexer-rebuild` |

## Commands

| Command           | Implementation | Description                                 |
| ----------------- | -------------- | ------------------------------------------- |
| `usync-ping`      | Native HTTP    | Poll until the Umbraco back-office responds |
| `indexer-rebuild` | Native HTTP    | Trigger one or more search index rebuilds   |
| `usync-import`    | uSync CLI      | Import all uSync items into Umbraco         |
| `usync-export`    | uSync CLI      | Export all uSync items from Umbraco         |
| `usync-report`    | uSync CLI      | Report pending changes without applying     |
| `cache-rebuild`   | uSync CLI      | Rebuild the Umbraco cache                   |
| `models-rebuild`  | uSync CLI      | Rebuild generated models                    |

**Native HTTP** commands call the Umbraco Management API directly — no .NET
tooling required. **uSync CLI** commands install `uSync.Cli` as a global .NET
tool on first run.

## YAML Examples

### Ping — wait for the site to be ready

Blocks subsequent steps until Umbraco is responding. Retries automatically
(default 10 attempts) before failing.

```yaml
- name: Wait for Umbraco
  uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.USYNC_CLIENT_ID }}
    secret: ${{ secrets.USYNC_SECRET }}
    command: usync-ping
```

### Indexer rebuild — trigger one or more indexes

Pass a comma-separated list of index names. Missing indexes produce a warning
and do not fail the action. Umbraco processes rebuilds asynchronously — the
action does not wait for completion.

```yaml
- name: Rebuild search indexes
  uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.USYNC_CLIENT_ID }}
    secret: ${{ secrets.USYNC_SECRET }}
    command: indexer-rebuild
    index-name: 'ExternalIndex, InternalIndex'
```

Inspect the per-index outcome from a later step:

```yaml
- name: Print index results
  run: echo '${{ steps.rebuild.outputs.index-results }}'
```

### Report — check what would change without applying anything

```yaml
- name: uSync Report
  uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.USYNC_CLIENT_ID }}
    secret: ${{ secrets.USYNC_SECRET }}
    command: usync-report
```

### Import — apply uSync changes

```yaml
- name: uSync Import
  uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.USYNC_CLIENT_ID }}
    secret: ${{ secrets.USYNC_SECRET }}
    command: usync-import
    additional-args: '--force'
```

## Complete Workflow Example

A full pipeline that deploys an Umbraco site, waits for it to respond, rebuilds
search indexes, and then synchronises uSync changes.

```yaml
name: Deploy and sync

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      # ... your build and deploy steps here ...

      - name: Wait for Umbraco to respond
        uses: mattou07/actions-uSync-cli@v1
        with:
          server: ${{ vars.UMBRACO_URL }}
          client-id: ${{ secrets.USYNC_CLIENT_ID }}
          secret: ${{ secrets.USYNC_SECRET }}
          command: usync-ping

      - name: Rebuild search indexes
        id: indexes
        uses: mattou07/actions-uSync-cli@v1
        with:
          server: ${{ vars.UMBRACO_URL }}
          client-id: ${{ secrets.USYNC_CLIENT_ID }}
          secret: ${{ secrets.USYNC_SECRET }}
          command: indexer-rebuild
          index-name: 'ExternalIndex, InternalIndex'

      - name: uSync Import
        uses: mattou07/actions-uSync-cli@v1
        with:
          server: ${{ vars.UMBRACO_URL }}
          client-id: ${{ secrets.USYNC_CLIENT_ID }}
          secret: ${{ secrets.USYNC_SECRET }}
          command: usync-import
          additional-args: '--force'
```

### Using a specific CLI version

Pin to a known-good version of the uSync CLI to avoid unexpected breakage from
upstream releases (only relevant for CLI-based commands):

```yaml
- uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.USYNC_CLIENT_ID }}
    secret: ${{ secrets.USYNC_SECRET }}
    command: usync-import
    usync-version: '16.0.0'
```

## API User Setup

The action authenticates using Umbraco's Management API with OAuth2 client
credentials.

1. In the Umbraco back office go to **Users** and create a new API user
2. Assign the user to a group with appropriate uSync permissions
3. Generate a **client ID** and **client secret** for the user
4. Store these as GitHub secrets and variables:

```
USYNC_CLIENT_ID=your-client-id
USYNC_SECRET=your-client-secret
UMBRACO_URL=https://your-site.com
```

Refer to the
[uSync CLI documentation](https://github.com/Jumoo/uSync.CommandLine) for full
details on API user configuration.

## Development

```bash
npm install
npm run all     # format, lint, test, and bundle
npm test        # run tests only
```

## License

MIT — see [LICENSE](LICENSE).

## Links

- [uSync CLI](https://github.com/Jumoo/uSync.CommandLine)
- [uSync Documentation](https://docs.jumoo.co.uk/usync/)
- [Umbraco CMS](https://umbraco.com/)

A single GitHub Action that installs the
[uSync CLI](https://github.com/Jumoo/uSync.CommandLine) and runs any uSync
command against your Umbraco instance. No separate setup step required.

## Prerequisites

- .NET SDK on the runner (add `actions/setup-dotnet` if your runner doesn't have
  it)
- An API user configured in Umbraco with a client ID and secret (see
  [API user setup](#api-user-setup))
- uSync installed on the target Umbraco site

## Usage

```yaml
- uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.USYNC_CLIENT_ID }}
    secret: ${{ secrets.USYNC_SECRET }}
    command: usync-import
```

The action installs `uSync.Cli` as a global .NET tool on first run and skips the
install on subsequent steps within the same job.

## Inputs

| Input             | Description                                          | Required | Default  |
| ----------------- | ---------------------------------------------------- | -------- | -------- |
| `server`          | URL of the Umbraco server                            | ✅       | -        |
| `client-id`       | OAuth2 client ID for the API user                    | ✅       | -        |
| `secret`          | OAuth2 client secret for the API user                | ✅       | -        |
| `command`         | uSync CLI command to run (see [Commands](#commands)) | ✅       | -        |
| `usync-version`   | Version of uSync CLI to install, or `latest`         | ❌       | `latest` |
| `additional-args` | Extra arguments appended to the command              | ❌       | `""`     |

## Outputs

| Output      | Description                              |
| ----------- | ---------------------------------------- |
| `success`   | `true` if the command exited with code 0 |
| `exit-code` | Raw exit code from the CLI               |
| `output`    | Combined stdout and stderr from the CLI  |

## Commands

Common commands exposed by the uSync CLI:

| Command           | Description                            |
| ----------------- | -------------------------------------- |
| `usync-ping`      | Poll until the Umbraco server responds |
| `usync-import`    | Import all uSync items into Umbraco    |
| `usync-export`    | Export all uSync items from Umbraco    |
| `cache-rebuild`   | Rebuild the Umbraco cache              |
| `models-rebuild`  | Rebuild generated models               |
| `indexer-rebuild` | Rebuild search indexes                 |

Run `uSync --help` on any runner to see the full list.

## YAML Examples

### Ping — wait for the site to be ready

Use this after a deployment to block subsequent steps until Umbraco is
responding. The CLI retries automatically until the server replies or times out.

```yaml
- name: Wait for Umbraco
  uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.USYNC_CLIENT_ID }}
    secret: ${{ secrets.USYNC_SECRET }}
    command: usync-ping
```

### Report — check what would change without applying anything

A dry-run style check. Useful on pull requests to surface pending uSync changes
as a job summary without touching the site.

```yaml
- name: uSync Report
  uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.USYNC_CLIENT_ID }}
    secret: ${{ secrets.USYNC_SECRET }}
    command: usync-report
```

### Import — apply uSync changes

Imports all pending uSync items into the target environment. Pass `--force` via
`additional-args` to overwrite items that already exist.

```yaml
- name: uSync Import
  uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.USYNC_CLIENT_ID }}
    secret: ${{ secrets.USYNC_SECRET }}
    command: usync-import
    additional-args: '--force'
```

## Complete Workflow Example

A full pipeline that deploys an Umbraco site and then synchronises uSync
changes: ping until the site is up, run a report for visibility, then import.

```yaml
name: Deploy and sync uSync changes

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      # ... your build and deploy steps here ...

      - name: Wait for Umbraco to respond
        uses: mattou07/actions-uSync-cli@v1
        with:
          server: ${{ vars.UMBRACO_URL }}
          client-id: ${{ secrets.USYNC_CLIENT_ID }}
          secret: ${{ secrets.USYNC_SECRET }}
          command: usync-ping

      - name: uSync Report
        id: report
        uses: mattou07/actions-uSync-cli@v1
        with:
          server: ${{ vars.UMBRACO_URL }}
          client-id: ${{ secrets.USYNC_CLIENT_ID }}
          secret: ${{ secrets.USYNC_SECRET }}
          command: usync-report

      - name: uSync Import
        uses: mattou07/actions-uSync-cli@v1
        with:
          server: ${{ vars.UMBRACO_URL }}
          client-id: ${{ secrets.USYNC_CLIENT_ID }}
          secret: ${{ secrets.USYNC_SECRET }}
          command: usync-import
          additional-args: '--force'
```

### Using a specific CLI version

Pin to a known-good version of uSync CLI to avoid unexpected breakage from
upstream releases:

```yaml
- uses: mattou07/actions-uSync-cli@v1
  with:
    server: ${{ vars.UMBRACO_URL }}
    client-id: ${{ secrets.USYNC_CLIENT_ID }}
    secret: ${{ secrets.USYNC_SECRET }}
    command: usync-import
    usync-version: '16.0.0'
```

## API User Setup

The uSync CLI uses Umbraco's Management API with OAuth2 client credentials. You
need to create an API user in Umbraco before using this action.

1. In the Umbraco back office go to **Users** and create a new API user
2. Assign the user to a group with appropriate uSync permissions
3. Generate a **client ID** and **client secret** for the user
4. Store these as GitHub secrets:

```
USYNC_CLIENT_ID=your-client-id
USYNC_SECRET=your-client-secret
```

```
UMBRACO_URL=https://your-site.com
```

Refer to the
[uSync CLI documentation](https://github.com/Jumoo/uSync.CommandLine) for full
details on API user configuration.

## Development

```bash
npm install
npm run all     # format, lint, test, and bundle
npm test        # run tests only
```

## License

MIT — see [LICENSE](LICENSE).

## Links

- [uSync CLI](https://github.com/Jumoo/uSync.CommandLine)
- [uSync Documentation](https://docs.jumoo.co.uk/usync/)
- [Umbraco CMS](https://umbraco.com/)

A comprehensive set of GitHub Actions for
[uSync CLI](https://github.com/Jumoo/uSync.CommandLine), enabling automated
Umbraco content and structure synchronization in your CI/CD pipelines.

## 🚀 Features

- **Setup Action**: Install and configure uSync CLI on GitHub runners
- **Low-Level Invoke Action**: Execute any uSync CLI command with flexible
  parameters
- **High-Level Specialized Actions**: Purpose-built actions for common workflows
- **Structure Import**: Import document types, data types, and structure with
  reporting
- **Content Import**: Import content items with optional pre-validation
- **Content Sync**: Full environment-to-environment content synchronization
- **Comprehensive Reporting**: Rich GitHub Actions summaries with detailed
  change tracking
- **Robust Error Handling**: Comprehensive error detection and informative
  failure messages
- **Shared Architecture**: Eliminates code duplication with shared utility
  functions

## 📦 Actions Available

### 1. Setup uSync CLI

Installs and configures the uSync CLI tool on the GitHub runner with version
detection and validation.

```yaml
- name: Setup uSync CLI
  uses: mattou07/actions-uSync-cli/Setup@v1
  with:
    dotnet-version: '8.0.x'
    usync-version: 'latest' # or specific version like '13.1.0'
```

### 2. Invoke Action (Low-Level)

Execute any uSync CLI command with flexible command strings. Perfect for custom
workflows or commands not covered by specialized actions.

```yaml
- name: Run Custom uSync Command
  uses: mattou07/actions-uSync-cli/invoke@v1
  with:
    command: 'run report'
    server: 'https://your-umbraco-site.com'
    key: ${{ secrets.USYNC_HMAC_KEY }}
    set: 'default'
    mode: 'all' # optional: 'structure', 'content', or 'all'
    force: 'false'
```

````

### 3. Import Structure

Import document types, data types, and compositions.

```yaml
- name: Import Structure
  uses: mattou07/actions-uSync-cli/import-structure@v1
  with:
    server: 'https://your-umbraco-site.com'
    key: ${{ secrets.USYNC_HMAC_KEY }}
    force: 'false'
    report-first: 'true'
````

### 4. Import Content

Import content items and pages.

```yaml
- name: Import Content
  uses: mattou07/actions-uSync-cli/import-content@v1
  with:
    server: 'https://your-umbraco-site.com'
    key: ${{ secrets.USYNC_HMAC_KEY }}
    force: 'false'
    report-first: 'true'
```

### 5. Sync Content Between Environments

Synchronize content from one environment to another.

```yaml
- name: Sync Content
  uses: mattou07/actions-uSync-cli/sync-content@v1
  with:
    source-server: 'https://staging.your-site.com'
    source-key: ${{ secrets.STAGING_HMAC_KEY }}
    target-server: 'https://production.your-site.com'
    target-key: ${{ secrets.PROD_HMAC_KEY }}
    set: 'default'
    force: 'false'
    report-first: 'true'
```

## 📋 Complete Workflow Examples

### Basic Structure and Content Import

```yaml
name: Import Umbraco Changes

on:
  push:
    branches: [main]
    paths: ['uSync/**']

jobs:
  import:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Setup uSync CLI
        uses: mattou07/actions-uSync-cli/Setup@v1

      - name: Import Structure
        id: structure
        uses: mattou07/actions-uSync-cli/import-structure@v1
        with:
          server: ${{ vars.UMBRACO_URL }}
          key: ${{ secrets.USYNC_HMAC_KEY }}
          report-first: 'true'

      - name: Import Content
        if: steps.structure.outputs.success == 'true'
        uses: mattou07/actions-uSync-cli/import-content@v1
        with:
          server: ${{ vars.UMBRACO_URL }}
          key: ${{ secrets.USYNC_HMAC_KEY }}
          report-first: 'true'
```

### Environment Synchronization

```yaml
name: Sync Production to Staging

on:
  schedule:
    - cron: '0 2 * * 1' # Weekly on Monday at 2 AM
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Setup uSync CLI
        uses: mattou07/actions-uSync-cli/Setup@v1

      - name: Dry Run Sync
        id: dry-run
        uses: mattou07/actions-uSync-cli/sync-content@v1
        with:
          source-server: ${{ vars.PROD_URL }}
          source-key: ${{ secrets.PROD_HMAC_KEY }}
          target-server: ${{ vars.STAGING_URL }}
          target-key: ${{ secrets.STAGING_HMAC_KEY }}
          report-first: 'true'

      - name: Actual Sync
        if: github.event_name == 'workflow_dispatch'
        uses: mattou07/actions-uSync-cli/sync-content@v1
        with:
          source-server: ${{ vars.PROD_URL }}
          source-key: ${{ secrets.PROD_HMAC_KEY }}
          target-server: ${{ vars.STAGING_URL }}
          target-key: ${{ secrets.STAGING_HMAC_KEY }}
          force: 'true'
```

### Report-Only Workflow

```yaml
name: uSync Report

on:
  pull_request:
    paths: ['uSync/**']

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup uSync CLI
        uses: mattou07/actions-uSync-cli/Setup@v1

      - name: Generate Report
        uses: mattou07/actions-uSync-cli/invoke@v1
        with:
          command: 'run report'
          server: ${{ vars.UMBRACO_URL }}
          key: ${{ secrets.USYNC_HMAC_KEY }}
```

## 🔧 Input Parameters

### Common Parameters

| Parameter | Description                       | Required | Default   |
| --------- | --------------------------------- | -------- | --------- |
| `server`  | Umbraco server URL                | ✅       | -         |
| `key`     | HMAC authentication key           | ✅       | -         |
| `set`     | Handler set to use                | ❌       | `default` |
| `force`   | Force import (overwrite existing) | ❌       | `false`   |

### Action-Specific Parameters

#### Setup Action

| Parameter        | Description                              | Required | Default  |
| ---------------- | ---------------------------------------- | -------- | -------- |
| `dotnet-version` | .NET SDK version to ensure               | ❌       | `8.0.x`  |
| `usync-version`  | uSync CLI version (`latest` or specific) | ❌       | `latest` |

#### Invoke Action

| Parameter | Description                                           | Required | Default |
| --------- | ----------------------------------------------------- | -------- | ------- |
| `command` | Command to execute (e.g., "run report", "run import") | ✅       | -       |
| `mode`    | Handler mode: `all`, `structure`, `content`           | ❌       | -       |

#### Sync Content Action

| Parameter       | Description              | Required | Default |
| --------------- | ------------------------ | -------- | ------- |
| `source-server` | Source environment URL   | ✅       | -       |
| `source-key`    | Source HMAC key          | ✅       | -       |
| `target-server` | Target environment URL   | ✅       | -       |
| `target-key`    | Target HMAC key          | ✅       | -       |
| `report-first`  | Run report before import | ❌       | `true`  |

#### Import Actions

| Parameter      | Description              | Default |
| -------------- | ------------------------ | ------- |
| `report-first` | Run report before import | `true`  |

## 📊 Outputs

All actions provide comprehensive outputs:

| Output    | Description                          |
| --------- | ------------------------------------ |
| `success` | Whether the operation was successful |
| `changes` | Number of changes detected/processed |
| `result`  | Detailed result message or output    |

### Action-Specific Outputs

#### Import Actions

| Output             | Description                          |
| ------------------ | ------------------------------------ |
| `report-result`    | Output from the report command       |
| `import-result`    | Output from the import command       |
| `changes-detected` | Number of changes detected in report |
| `changes-imported` | Number of changes actually imported  |

#### Sync Content Action

| Output                    | Description                          |
| ------------------------- | ------------------------------------ |
| `export-result`           | Output from the export command       |
| `report-result`           | Output from the report command       |
| `import-result`           | Output from the import command       |
| `source-changes`          | Number of items exported from source |
| `target-changes-detected` | Number of changes detected on target |
| `target-changes-imported` | Number of changes imported to target |

## 🏗️ Architecture

This action suite uses a modern, shared architecture that eliminates code
duplication:

### **Shared Utilities** (`src/shared/usync-utils.ts`)

- **`executeUSyncCommand()`** - Centralized command execution with consistent
  error handling
- **`parseChangesFromOutput()`** - Standardized parsing of uSync CLI output
- **`generateUSyncSummary()`** - Rich GitHub Actions job summaries with change
  details
- **`USyncExecutionResult`** - Unified result interface across all actions

### **Action Types**

- **Low-Level Invoke**: Flexible wrapper accepting raw CLI commands
- **High-Level Specialized**: Purpose-built workflows using shared utilities

### **Benefits**

- ✅ Zero code duplication between actions
- ✅ Consistent behavior and error handling
- ✅ Maintainable - single source of truth for core functionality
- ✅ Extensible - easy to add new specialized actions

## 🔐 Security Setup

1. **HMAC Keys**: Store your uSync HMAC keys as GitHub secrets:

   ```
   USYNC_HMAC_KEY=your-production-key
   STAGING_HMAC_KEY=your-staging-key
   ```

2. **Environment URLs**: Use GitHub variables for server URLs:
   ```
   UMBRACO_URL=https://your-site.com
   STAGING_URL=https://staging.your-site.com
   ```

## 🛠️ Development

### Building the Actions

```bash
npm install
npm run all
```

### Testing

```bash
npm test
npm run coverage
```

### Package Individual Actions

```bash
npm run package:setup
npm run package:invoke
npm run package:sync-content
npm run package:import-structure
npm run package:import-content
```

## 📄 Requirements

- .NET SDK 6.0+ on the runner (for uSync CLI)
- uSync enabled on your Umbraco site
- Valid HMAC authentication configured
- uSync files in your repository (typically in `uSync/` folder)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run `npm run all` to format, lint, test, and package
6. Submit a pull request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file
for details.

## 🔗 Related Links

- [uSync CLI](https://github.com/Jumoo/uSync.CommandLine)
- [uSync Documentation](https://docs.jumoo.co.uk/usync/)
- [Umbraco CMS](https://umbraco.com/)

## 📞 Support

If you encounter issues or have questions:

1. Check the [Issues](https://github.com/mattou07/actions-uSync-cli/issues) page
2. Review the uSync CLI documentation
3. Create a new issue with detailed information
