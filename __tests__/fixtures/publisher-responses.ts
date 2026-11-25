import type { SyncPublishServerView } from '../../src/types/publisher.js'

/* Placeholder Publisher servers. */

export const CURRENT_SERVER: SyncPublishServerView = {
  key: '00000000-0000-0000-0000-000000000501',
  alias: 'local',
  enabled: true,
  name: 'This site',
  url: 'https://example.com'
}

export const STAGING_SERVER: SyncPublishServerView = {
  key: '00000000-0000-0000-0000-000000000502',
  alias: 'staging',
  enabled: true,
  name: 'Staging',
  url: 'https://staging.example.com'
}

export const LIVE_SERVER: SyncPublishServerView = {
  key: '00000000-0000-0000-0000-000000000503',
  alias: 'live',
  enabled: true,
  name: 'Live',
  url: 'https://live.example.com'
}
