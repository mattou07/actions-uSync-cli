// Runs the bundled action (dist/index.js) the way a GitHub runner does:
// inputs come from .env (INPUT_<NAME>, hyphens kept), outputs, the job summary
// and the results file are written to files in a run folder.
//
// Usage: npm run bundle && npm run local-run -- [INPUT_X=value ...] [--dir <folder>]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

let runDir = path.join(repo, '.local-run')
const dirFlag = args.indexOf('--dir')
if (dirFlag !== -1) {
  runDir = path.resolve(args[dirFlag + 1] ?? runDir)
  args.splice(dirFlag, 2)
}
fs.mkdirSync(runDir, { recursive: true })

const envFile = path.join(repo, '.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^(INPUT_[^=]+)=(.*)$/.exec(line.trim())
    if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
  }
}
for (const arg of args) {
  const i = arg.indexOf('=')
  if (i > 0) process.env[arg.slice(0, i)] = arg.slice(i + 1)
}

const outputFile = path.join(runDir, 'output.txt')
const summaryFile = path.join(runDir, 'summary.md')
for (const f of [outputFile, summaryFile]) fs.writeFileSync(f, '')
process.env.GITHUB_OUTPUT = outputFile
process.env.GITHUB_STEP_SUMMARY = summaryFile
process.env.RUNNER_TEMP = runDir

process.on('exit', () => {
  console.log(`\n[local-run] exit code ${process.exitCode ?? 0}`)
  console.log(`[local-run] outputs:  ${outputFile}`)
  console.log(`[local-run] summary:  ${summaryFile}`)
  console.log(
    `[local-run] results:  ${path.join(runDir, 'usync-results.json')}`
  )
})

await import(pathToFileURL(path.join(repo, 'dist/index.js')).href)
