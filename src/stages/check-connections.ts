import { SERVER_STATUS_SUCCESS } from '../types/publisher.js'
import { safeInfo, safeWarning } from '../utils/safe-log.js'
import type { Stage } from './types.js'
import { errorMessage } from './types.js'

export interface ConnectionCheck {
  alias: string
  name: string
  url: string
  enabled: boolean
  status: string
  message?: string
  healthy: boolean
}

export interface CheckConnectionsData {
  servers: ConnectionCheck[]
}

export const checkConnectionsStage: Stage = {
  id: 'check-connections',
  title: 'Connection check',
  enabled: (inputs) => inputs.checkConnections,
  async run(ctx) {
    const all = await ctx.publisher.getAllServers(true)
    if (!all) {
      return {
        status: 'skipped',
        summary: 'uSync.Complete (Publisher) is not installed'
      }
    }
    const current = await ctx.publisher.getCurrentServer()
    const servers = all.filter(
      (s) => !current || (s.key !== current.key && s.alias !== current.alias)
    )
    if (servers.length === 0) {
      return { status: 'skipped', summary: 'No Publisher servers configured' }
    }

    const checks = await Promise.all(
      servers.map(async (server): Promise<ConnectionCheck> => {
        const base = {
          alias: server.alias,
          name: server.name,
          url: server.url
        }
        try {
          const result = await ctx.publisher.checkServer(server.alias)
          return {
            ...base,
            enabled: result.enabled,
            status: result.status,
            message: result.message ?? undefined,
            healthy: result.status === SERVER_STATUS_SUCCESS
          }
        } catch (error) {
          return {
            ...base,
            enabled: server.enabled,
            status: 'Error',
            message: errorMessage(error),
            healthy: false
          }
        }
      })
    )

    for (const c of checks) {
      const line = `${c.name} (${c.alias}): ${c.status}${c.message ? ` - ${c.message}` : ''}`
      if (c.healthy) safeInfo(line)
      else safeWarning(line)
    }

    const unhealthy = checks.filter((c) => !c.healthy).length
    const summary = `${checks.length - unhealthy} of ${checks.length} servers reported ${SERVER_STATUS_SUCCESS}`
    let status: 'failed' | 'warning' | 'success' = 'success'
    if (unhealthy > 0) {
      status = ctx.inputs.failOnConnectionError ? 'failed' : 'warning'
    }
    return {
      status,
      summary,
      data: { servers: checks } satisfies CheckConnectionsData
    }
  }
}
