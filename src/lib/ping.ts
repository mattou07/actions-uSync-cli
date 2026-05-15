import * as core from '@actions/core'
import { getAccessToken } from './auth'

/**
 * Polls the Umbraco back-office token endpoint until it responds successfully,
 * confirming the server is up and credentials are valid.
 *
 * Reference: uSync.Commands/uSync/uSyncPingCommand.cs
 *
 * @param retryDelayMs  Milliseconds to wait between attempts. Exposed for
 *                      testing so tests can pass 0 and avoid real delays.
 */
export async function ping(
  server: string,
  clientId: string,
  secret: string,
  retries = 10,
  retryDelayMs = 3000
): Promise<void> {
  core.info(`🔍 Pinging Umbraco at ${server} (up to ${retries} attempts)`)

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await getAccessToken(server, clientId, secret)
      core.info(`✅ Umbraco is reachable (attempt ${attempt}/${retries})`)
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      core.info(`⏳ Attempt ${attempt}/${retries} failed: ${message}`)
      if (attempt < retries) {
        await delay(retryDelayMs)
      }
    }
  }

  throw new Error(
    `Umbraco server at ${server} did not respond after ${retries} attempts`
  )
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
