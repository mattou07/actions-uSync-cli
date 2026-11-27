# actions-uSync-cli

GitHub Action (TypeScript, ESM, Node 24) that runs uSync on a deployed Umbraco
site through the Management API: wait → pre-report → import → report → (rebuild
cache, rebuild indexes, export) → connection check → job summary. It only ever
talks to the `server` it is given. No dotnet, no shell calls.

## Commands

| Task                             | Command                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| Install                          | `npm ci`                                                                                    |
| Tests + coverage (100% enforced) | `npm run ci-test`                                                                           |
| One test file                    | `npx cross-env NODE_OPTIONS=--experimental-vm-modules npx jest __tests__/path/file.test.ts` |
| Type check                       | `npx tsc --noEmit -p tsconfig.json`                                                         |
| Lint / format check              | `npm run lint` / `npm run format:check`                                                     |
| Format + rebuild `dist/`         | `npm run bundle`                                                                            |
| Run the action locally           | `npm run bundle` then `npm run local-run`                                                   |

`dist/` is committed and is what GitHub runs. After any change in `src/`, run
`npm run bundle` and commit `dist/` too, or the `check-dist` workflow fails.

## Layout

- `src/index.ts`, `src/main.ts`: `run()` parses inputs, runs the pipeline,
  writes the summary and outputs. try/catch/finally.
- `src/inputs.ts`: all input parsing and validation. Masks secrets, enforces
  https (http only for localhost).
- `src/pipeline.ts`: ordered stage list; skip/abort/continue policy; collects
  `StageResult`.
- `src/stages/`: one file per stage (wait, pre-report, import, report,
  rebuild-cache, rebuild-indexes, export, check-connections). Each has an
  `enabled(inputs)` predicate and `run(ctx)`.
- `src/api/http.ts`: `HttpClient` (fetch, per-attempt timeout, retries, 401
  refresh), `ApiError` with capped, redacted body.
- `src/api/token-provider.ts`: client credentials token, cached, refreshed
  before expiry.
- `src/api/umbraco-api.ts`, `usync-api.ts`, `publisher-api.ts`: the only places
  that call Umbraco, uSync and uSync Publisher. A 404 on an optional endpoint
  returns `undefined` (version or uSync.Complete not available).
- `src/usync/perform.ts`: step loop (normal mode) and `Status` polling
  (background mode). `src/usync/analyse.ts`: classifies actions into errors,
  changes and warnings.
- `src/report/summary.ts`: job summary tables. Summary tables are raw HTML.
- `src/utils/`: poll, sleep, safe-log, redact, duration.
- `src/types/`: uSync, Publisher and Umbraco response types.
- `__tests__/`: mirrors `src/`, with fixtures for every endpoint and mode.
- `action.yml`: inputs and outputs. Keep it, `README.md` and `.env.example` in
  step when an input or output changes.

## Running locally

1. `npm ci`
2. Copy `.env.example` to `.env` (gitignored) and fill it in. Inputs are
   `INPUT_<NAME>` with hyphens kept, e.g. `INPUT_CLIENT-ID`.
3. `npm run bundle`, then `npm run local-run` (`script/local-run.mjs`). It runs
   `dist/index.js` like a runner: `INPUT_*` from `.env`, `INPUT_X=value` CLI
   overrides, and outputs, summary and results file in `.local-run/`
   (gitignored), whose paths it prints.

Things that differ from a real runner:

- It runs `dist/`, so rebuild after changing `src/`.
- Use the site's https URL (e.g. `https://localhost:44324`): Umbraco's token
  endpoint (OpenIddict) only accepts HTTPS, so `http://localhost` cannot
  authenticate. The http-for-localhost exception stays for TLS-terminating
  proxies.
- Node does not trust the ASP.NET dev certificate (self-signed leaf, not a CA,
  so `NODE_EXTRA_CA_CERTS` does not help). Set `NODE_TLS_REJECT_UNAUTHORIZED=0`
  for local runs only, never in a workflow.
- You need a local API user (backoffice Users > API Users) with a client ID
  starting `umbraco-back-office-`.
- Artifact upload needs `ACTIONS_RUNTIME_TOKEN`; locally the Export stage warns
  and keeps the zip in the run folder.
- Import and export change real data. Point it at a test site.

## Rules for changes

- **Structure decides, text enriches.** Branch on HTTP status, enum values
  (`change`, `status`, run level) and `success`, never on message wording. Text
  may add detail only and must fail safe.
- **Coverage stays at 100%** (`jest.config.js` threshold). Remove unreachable
  code rather than adding `istanbul ignore`.
- **Tests are ESM.** Use `jest.unstable_mockModule(...)` then
  `await import(...)`; `jest.mock()` is a no-op here. Mock `sleep` so waits
  resolve instantly.
- **No real site data in the repo.** Fixtures, tests and docs use
  `https://example.com`, `umbraco-back-office-test` and placeholder GUIDs. Never
  commit `.env` or anything captured from a real site.
- **Secrets:** call `core.setSecret` for secrets and tokens; never log request
  headers or tokens.
- **Escape server text:** anything from the server (item names, messages, server
  names and URLs) goes through `safeInfo`/`safeWarning` for logs and
  `escapeHtml` for the summary.
- Keep `action.yml`, `README.md` and `.env.example` in step.
- Run `npm run bundle` and commit `dist/` after any `src` change.
- Don't commit or push unless asked. Commits are GPG-signed by the user, so
  stage the changes and hand over a commit message.
