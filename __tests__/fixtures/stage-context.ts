import { jest } from '@jest/globals'
import type { ActionInputs } from '../../src/inputs.js'
import type { PublisherApi } from '../../src/api/publisher-api.js'
import type { UmbracoApi } from '../../src/api/umbraco-api.js'
import type { USyncApi } from '../../src/api/usync-api.js'
import type { ArtifactUploader, StageContext } from '../../src/stages/types.js'

export const BASE_INPUTS: ActionInputs = {
  server: 'https://example.com',
  clientId: 'umbraco-back-office-test',
  clientSecret: 'placeholder-secret',
  wait: true,
  waitTimeoutMinutes: 10,
  waitForStartupImport: true,
  import: true,
  force: false,
  set: '',
  group: 'all',
  report: true,
  failOnChanges: false,
  rebuildCache: false,
  rebuildIndexes: [],
  export: false,
  exportClean: false,
  downloadExport: false,
  exportArtifactName: 'usync-export',
  checkConnections: true,
  failOnConnectionError: false,
  timeoutMinutes: 30,
  requestTimeoutSeconds: 60
}

export function makeInputs(
  overrides: Partial<ActionInputs> = {}
): ActionInputs {
  return { ...BASE_INPUTS, ...overrides }
}

/** Plain fake API objects so stage tests need no module mocking. */
export function makeContext(
  inputOverrides: Partial<ActionInputs> = {},
  tempDir = '/tmp'
) {
  const umbraco = {
    getServerStatus: jest.fn<UmbracoApi['getServerStatus']>(),
    getServerInformation: jest.fn<UmbracoApi['getServerInformation']>(),
    rebuildIndex: jest.fn<UmbracoApi['rebuildIndex']>(),
    rebuildPublishedCache: jest.fn<UmbracoApi['rebuildPublishedCache']>(),
    getPublishedCacheRebuildStatus:
      jest.fn<UmbracoApi['getPublishedCacheRebuildStatus']>()
  }
  const usync = {
    perform: jest.fn<USyncApi['perform']>(),
    getOperationStatus: jest.fn<USyncApi['getOperationStatus']>(),
    getRunning: jest.fn<USyncApi['getRunning']>(),
    getStartupStatus: jest.fn<USyncApi['getStartupStatus']>(),
    getSettings: jest.fn<USyncApi['getSettings']>(),
    getVersion: jest.fn<USyncApi['getVersion']>(),
    download: jest.fn<USyncApi['download']>()
  }
  const publisher = {
    getAllServers: jest.fn<PublisherApi['getAllServers']>(),
    getCurrentServer: jest.fn<PublisherApi['getCurrentServer']>(),
    checkServer: jest.fn<PublisherApi['checkServer']>()
  }
  const artifacts = {
    upload: jest.fn<ArtifactUploader['upload']>()
  }
  const ctx: StageContext = {
    inputs: makeInputs(inputOverrides),
    umbraco: umbraco as unknown as UmbracoApi,
    usync: usync as unknown as USyncApi,
    publisher: publisher as unknown as PublisherApi,
    site: { set: 'Default' },
    results: {},
    artifacts,
    tempDir
  }
  return { ctx, umbraco, usync, publisher, artifacts }
}
