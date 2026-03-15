/**
 * Tunnel client for Flow Weaver Cloud Studio.
 *
 * Opens a WebSocket to the cloud server's /api/tunnel endpoint and
 * dispatches incoming RPC calls to local handler functions. This gives
 * Cloud Studio real-time access to the user's local filesystem, AST
 * parser, compiler, and execution engine without uploading any files.
 *
 * @module
 */
import WebSocket from 'ws';
import { dispatch } from './dispatch.js';

export interface TunnelOptions {
  /** API key (fw_xxx) */
  key: string;
  /** Cloud server URL (default: https://flowweaver.ai) */
  cloud?: string;
  /** Local workspace directory (default: cwd) */
  dir?: string;
  /** WebSocket factory (for testing) */
  createWs?: (url: string) => WebSocket;
  /** Logger (defaults to console) */
  logger?: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    debug(msg: string): void;
  };
}

interface TunnelRequest {
  type: 'tunnel:request';
  requestId: string;
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export async function startTunnel(options: TunnelOptions): Promise<void> {
  const cloudUrl = options.cloud || 'https://flowweaver.ai';
  const workspaceRoot = options.dir
    ? (await import('node:path')).resolve(options.dir)
    : process.cwd();
  const createWs = options.createWs ?? ((url: string) => new WebSocket(url));
  const log = options.logger ?? {
    info: (msg: string) => console.log(`[tunnel] ${msg}`),
    warn: (msg: string) => console.warn(`[tunnel] ${msg}`),
    error: (msg: string) => console.error(`[tunnel] ${msg}`),
    debug: (msg: string) => console.debug(`[tunnel] ${msg}`),
  };

  log.info(`Cloud:     ${cloudUrl}`);
  log.info(`Workspace: ${workspaceRoot}`);

  // -----------------------------------------------------------------------
  // 1. Connect to cloud server via WebSocket
  // -----------------------------------------------------------------------
  log.info('Connecting to cloud server...');
  const wsProtocol = cloudUrl.startsWith('https') ? 'wss' : 'ws';
  const wsHost = cloudUrl.replace(/^https?:\/\//, '');
  const wsUrl = `${wsProtocol}://${wsHost}/api/tunnel?token=${encodeURIComponent(options.key)}`;

  const cloudWs = createWs(wsUrl);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cloudWs.close();
      reject(new Error('Cloud server connection timeout (10s)'));
    }, 10_000);

    cloudWs.on('open', () => {
      clearTimeout(timeout);
    });

    cloudWs.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'tunnel:hello') {
          log.info('Connected to cloud server');
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          cloudWs.close();
          reject(new Error(`Cloud server rejected connection: ${msg.message}`));
        }
      } catch {
        // Ignore parse errors during handshake
      }
    });

    cloudWs.on('error', (err: Error) => {
      clearTimeout(timeout);
      reject(new Error(`Cannot connect to cloud server: ${err.message}`));
    });
  });

  log.info('Tunnel active. Press Ctrl+C to disconnect.');

  let requestCount = 0;
  const ctx = { workspaceRoot };

  // -----------------------------------------------------------------------
  // 2. Handle RPC: cloud -> local dispatch -> cloud
  // -----------------------------------------------------------------------
  cloudWs.on('message', async (raw: WebSocket.RawData) => {
    let msg: { type: string } & Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'ping') {
      cloudWs.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (msg.type === 'tunnel:request') {
      const req = msg as unknown as TunnelRequest;
      requestCount++;
      log.debug(`[${requestCount}] -> ${req.method}`);

      const response = await dispatch(req.method, req.params || {}, ctx);

      cloudWs.send(
        JSON.stringify({
          type: 'tunnel:response',
          requestId: req.requestId,
          id: req.id,
          success: response.success,
          result: response.result,
          error: response.error,
        }),
      );
    }
  });

  // -----------------------------------------------------------------------
  // 3. Handle disconnections
  // -----------------------------------------------------------------------
  cloudWs.on('close', (code: number, reason: Buffer) => {
    log.warn(`Cloud server disconnected: ${code} ${reason.toString()}`);
    log.info('Shutting down tunnel...');
    process.exit(code === 4001 ? 1 : 0);
  });

  cloudWs.on('error', (err: Error) => {
    log.error(`Cloud WebSocket error: ${err.message}`);
  });

  // -----------------------------------------------------------------------
  // 4. Graceful shutdown
  // -----------------------------------------------------------------------
  process.on('SIGINT', () => {
    log.info(`Shutting down tunnel (${requestCount} requests handled)...`);
    cloudWs.close();
    process.exit(0);
  });

  // Keep alive until SIGINT or cloud disconnect
  await new Promise(() => {});
}
