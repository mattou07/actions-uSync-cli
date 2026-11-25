import type {
  PerformActionResponse,
  SyncHandlerSummary,
  SyncOperationStatusResponse,
  USyncActionView
} from '../../src/types/usync.js'

/* Placeholder uSync responses shaped like the real server's. */

export const IMPORT_REQUEST_ID = '00000000-0000-0000-0000-0000000000a1'
export const BACKGROUND_OPERATION_ID = '00000000-0000-0000-0000-0000000000b1'

export const DATA_TYPE_ITEMS: USyncActionView[] = [
  {
    key: '00000000-0000-0000-0000-000000000101',
    name: 'Richtext editor',
    handler: 'Data Types',
    itemType: 'IDataType',
    change: 'Update',
    success: true,
    details: [
      {
        success: true,
        name: 'Config',
        path: 'Info/Config',
        oldValue: '{"toolbar":["bold"]}',
        newValue: '{"toolbar":["bold","italic"]}',
        change: 'Update'
      }
    ]
  },
  {
    key: '00000000-0000-0000-0000-000000000102',
    name: 'Label',
    handler: 'Data Types',
    itemType: 'IDataType',
    change: 'NoChange',
    success: true,
    details: []
  }
]

export const CONTENT_TYPE_ITEMS: USyncActionView[] = [
  {
    key: '00000000-0000-0000-0000-000000000201',
    name: 'Home page',
    handler: 'Content Types',
    itemType: 'IContentType',
    change: 'Import',
    success: true,
    details: [
      {
        success: true,
        name: 'Icon',
        path: 'Info/Icon',
        oldValue: 'icon-home',
        newValue: 'icon-umb-content',
        change: 'Update'
      },
      {
        success: true,
        name: 'Unknown property editor',
        path: 'Properties/legacy',
        oldValue: null,
        newValue: null,
        change: 'Warning'
      }
    ]
  }
]

export const TEMPLATE_ITEMS: USyncActionView[] = [
  {
    key: '00000000-0000-0000-0000-000000000301',
    name: 'Broken template',
    handler: 'Templates',
    itemType: 'ITemplate',
    change: 'ImportFail',
    success: false,
    message: 'Could not compile the template',
    details: [
      {
        success: false,
        name: 'Content',
        path: 'Content',
        oldValue: null,
        newValue: null,
        change: 'Error'
      }
    ]
  }
]

const handler = (
  name: string,
  status: SyncHandlerSummary['status'],
  changes = 0,
  inError = false
): SyncHandlerSummary => ({ name, status, changes, inError })

/** Import in normal mode: one handler per step, cumulative state. */
export const IMPORT_STEP_RESPONSES: PerformActionResponse[] = [
  {
    requestId: IMPORT_REQUEST_ID,
    complete: false,
    status: [
      handler('Data Types', 'Complete', 1),
      handler('Content Types', 'Pending'),
      handler('Templates', 'Pending')
    ],
    actions: [...DATA_TYPE_ITEMS]
  },
  {
    requestId: IMPORT_REQUEST_ID,
    complete: false,
    status: [
      handler('Data Types', 'Complete', 1),
      handler('Content Types', 'Complete', 1),
      handler('Templates', 'Pending')
    ],
    actions: [...DATA_TYPE_ITEMS, ...CONTENT_TYPE_ITEMS]
  },
  {
    requestId: IMPORT_REQUEST_ID,
    complete: true,
    status: [
      handler('Data Types', 'Complete', 1),
      handler('Content Types', 'Complete', 1),
      handler('Templates', 'Error', 0, true)
    ],
    actions: [...DATA_TYPE_ITEMS, ...CONTENT_TYPE_ITEMS, ...TEMPLATE_ITEMS]
  }
]

export const REPORT_ACTIONS: USyncActionView[] = [
  {
    key: '00000000-0000-0000-0000-000000000401',
    name: 'New block',
    handler: 'Content Types',
    itemType: 'IContentType',
    change: 'Create',
    success: true,
    details: []
  },
  {
    key: '00000000-0000-0000-0000-000000000402',
    name: 'Article',
    handler: 'Content Types',
    itemType: 'IContentType',
    change: 'Update',
    success: true,
    details: [
      {
        success: true,
        name: 'Name',
        path: 'Info/Name',
        oldValue: 'Article',
        newValue: 'News article',
        change: 'Update'
      },
      {
        success: true,
        name: 'Description',
        path: 'Info/Description',
        oldValue: null,
        newValue: 'Used for news',
        change: 'Create'
      }
    ]
  },
  {
    key: '00000000-0000-0000-0000-000000000403',
    name: 'Old template',
    handler: 'Templates',
    itemType: 'ITemplate',
    change: 'Delete',
    success: true,
    details: []
  },
  {
    key: '00000000-0000-0000-0000-000000000404',
    name: 'Footer',
    handler: 'Templates',
    itemType: 'ITemplate',
    change: 'WillChange',
    success: true,
    details: [
      {
        success: true,
        name: 'Content',
        path: 'Content',
        oldValue: '<footer>old</footer>',
        newValue: '<footer>new</footer>',
        change: 'Update'
      }
    ]
  }
]

export const REPORT_RESPONSE: PerformActionResponse = {
  requestId: IMPORT_REQUEST_ID,
  complete: true,
  status: [
    handler('Content Types', 'Complete', 2),
    handler('Templates', 'Complete', 2)
  ],
  actions: REPORT_ACTIONS
}

export const EXPORT_RESPONSE: PerformActionResponse = {
  requestId: IMPORT_REQUEST_ID,
  complete: true,
  status: [
    handler('Data Types', 'Complete', 2),
    handler('Content Types', 'Complete', 1)
  ],
  actions: [
    { ...DATA_TYPE_ITEMS[0], change: 'Export', details: [] },
    { ...DATA_TYPE_ITEMS[1], change: 'Export', details: [] },
    { ...CONTENT_TYPE_ITEMS[0], change: 'Export', details: [] }
  ]
}

/** Server moved the run into a background operation. */
export const BACKGROUND_START_RESPONSE: PerformActionResponse = {
  requestId: IMPORT_REQUEST_ID,
  complete: false,
  inBackground: true,
  operationId: BACKGROUND_OPERATION_ID,
  status: [],
  actions: []
}

const statusResponse = (
  operationStatus: string,
  complete: boolean,
  extra: Partial<SyncOperationStatusResponse> = {}
): SyncOperationStatusResponse => ({
  operationId: BACKGROUND_OPERATION_ID,
  requestId: IMPORT_REQUEST_ID,
  action: 'Import',
  operationStatus,
  complete,
  ...extra
})

export const BACKGROUND_STATUS_ENQUEUED = statusResponse('Enqueued', false)

export const BACKGROUND_STATUS_RUNNING = statusResponse('Running', false, {
  status: [
    handler('Data Types', 'Complete', 1),
    handler('Content Types', 'Processing'),
    handler('Templates', 'Pending')
  ],
  actions: [...DATA_TYPE_ITEMS]
})

export const BACKGROUND_STATUS_SUCCESS = statusResponse('Success', true, {
  status: [
    handler('Data Types', 'Complete', 1),
    handler('Content Types', 'Complete', 1)
  ],
  actions: [...DATA_TYPE_ITEMS, ...CONTENT_TYPE_ITEMS]
})

export const BACKGROUND_STATUS_FAILED = statusResponse('Failed', true, {
  status: [
    handler('Data Types', 'Complete', 1),
    handler('Content Types', 'Complete', 1),
    handler('Templates', 'Error', 0, true)
  ],
  actions: [...DATA_TYPE_ITEMS, ...CONTENT_TYPE_ITEMS, ...TEMPLATE_ITEMS],
  message: 'The operation failed'
})

export const BACKGROUND_STATUS_STALE = statusResponse('Stale', true, {
  message: 'The operation stopped reporting progress'
})

/** Response when another run of the same action holds the lock. */
export const ALREADY_RUNNING_RESPONSE: PerformActionResponse = {
  requestId: '',
  complete: true,
  inBackground: false,
  message: 'A Import process is already running...',
  actions: []
}
