import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';

export interface BridgeInfo {
  token: string;
  portStart: number;
  portEnd: number;
  port: number;
}

export class BackgroundBridge {
  private server?: Server;
  private readonly token: string;
  private readonly portStart = 48721;
  private readonly portEnd = 48730;
  private port?: number;

  constructor(private readonly state: () => unknown, token?: string) {
    this.token = token ?? randomBytes(24).toString('hex');
  }

  async start(): Promise<BridgeInfo> {
    if (this.server && this.port) return this.info();
    for (let port = this.portStart; port <= this.portEnd; port += 1) {
      try {
        await this.listen(port);
        this.port = port;
        return this.info();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      }
    }
    throw new Error('无法启动背景行情桥接：本地端口均被占用');
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((request, response) => {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (request.method !== 'GET' || request.url !== `/${this.token}/state`) {
          response.statusCode = 404;
          response.end(JSON.stringify({ error: 'not found' }));
          return;
        }
        response.end(JSON.stringify(this.state()));
      });
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        this.server = server;
        resolve();
      });
    });
  }

  info(): BridgeInfo {
    if (!this.port) throw new Error('背景桥接尚未启动');
    return { token: this.token, portStart: this.portStart, portEnd: this.portEnd, port: this.port };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    this.port = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

