// ── Server → Helper Messages ──

export interface HelperSessionReadyMessage {
  type: 'session.ready';
  localPort: number;
}

export interface HelperSessionClosedMessage {
  type: 'session.closed';
  reason: string;
}

export interface HelperErrorMessage {
  type: 'error';
  message: string;
}

export type ServerToHelperMessage =
  | HelperSessionReadyMessage
  | HelperSessionClosedMessage
  | HelperErrorMessage;

// ── Helper → Server Messages ──

export interface HelperSessionBindMessage {
  type: 'session.bind';
  port: number;
}

export interface HelperSessionCloseMessage {
  type: 'session.close';
}

export type HelperToServerMessage =
  | HelperSessionBindMessage
  | HelperSessionCloseMessage;
