export const PLUGIN_ID = 'rumSessionReplay';
export const PLUGIN_NAME = 'Session Replay';

// Elasticsearch indices — match EDOT Collector routing exactly
export const INDEX_REPLAY = 'logs-rum.replay-default';
export const INDEX_TRACES = 'traces-generic.otel-default';
export const INDEX_LOGS = 'logs-generic.otel-default';
export const INDEX_METRICS = 'metrics-generic.otel-default';

// API route prefix
export const API_BASE = '/api/rum-session-replay';

// Field names — do not rename (contract with EDOT RUM SDK)
export const FIELDS = {
  SESSION_ID: 'attributes.session\\.id',
  RRWEB_EVENT: 'attributes.rr-web\\.event',
  RRWEB_TYPE: 'attributes.rrweb\\.type',
  RRWEB_PACKED: 'attributes.rrweb\\.packed',
  PAGE_URL: 'attributes.page\\.url',
  PAGE_URL_PATH: 'attributes.page\\.url\\.path',
  USER_ID: 'attributes.user\\.id',
  USER_EMAIL: 'attributes.user\\.email',
  USER_NAME: 'attributes.user\\.name',
  LOG_TYPE: 'attributes.elastic\\.rum\\.log\\.type',
} as const;

// rrweb EventType values
export const RRWEB_EVENT_TYPE = {
  DOM_CONTENT_LOADED: 0,
  LOAD: 1,
  FULL_SNAPSHOT: 2,
  INCREMENTAL_SNAPSHOT: 3,
  META: 4,
  CUSTOM: 5,
} as const;
