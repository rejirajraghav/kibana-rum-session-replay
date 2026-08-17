export interface SessionSummary {
  sessionId: string;
  userEmail?: string;
  userName?: string;
  userId?: string;
  startTime: string; // ISO
  endTime: string; // ISO
  durationMs: number;
  errorCount: number;
  eventCount: number;
  pages: string[]; // distinct page URL paths
}

export interface ReplayEvent {
  timestamp: number; // ms — from parsed body.timestamp
  type: number; // rrweb EventType
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any; // raw rrweb event object — passed directly to Replayer
  pageUrl?: string;
  pageUrlPath?: string;
}

export interface PageNavigation {
  timestamp: string; // ISO
  path: string;
  url: string;
  offsetMs: number; // ms from session start
}

export interface SessionError {
  timestamp: string; // ISO
  message: string;
  type: string;
  offsetMs: number; // ms from session start — used to seek player
  stack?: string;
}

export interface NetworkEvent {
  timestamp: string;
  method: string;
  url: string;
  statusCode?: number;
  durationMs?: number;
  traceId?: string;
}

export interface SessionMetadata {
  sessionId: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  pages: PageNavigation[];
  errors: SessionError[];
  networkEvents: NetworkEvent[];
}

export interface SessionListResponse {
  sessions: SessionSummary[];
  total: number;
}

export interface SessionEventsResponse {
  events: ReplayEvent[];
  metadata: SessionMetadata;
}
