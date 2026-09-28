import type { Server } from 'node:http';
import express, { type Express, type Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { prisma } from '@a-health/database';
import { createLogger, type Logger } from '@a-health/logger';
import { requestContext } from './middleware/context.js';
import { createErrorHandler, notFoundHandler } from './middleware/error.js';

export interface ServiceOptions {
  name: string;
  port: number;
  host?: string;
  routers: Router[];
  development?: boolean;
  /** Extra dependency probes surfaced by GET /health. */
  healthChecks?: Record<string, () => Promise<boolean>>;
  onShutdown?: () => Promise<void>;
  /** Passed through to express.json()'s own `verify` option. Only used by services that need the exact raw bytes (e.g. HMAC verification) -- everything else leaves this unset. */
  jsonVerify?: (req: unknown, res: unknown, buf: Buffer) => void;
}

export interface Service {
  app: Express;
  logger: Logger;
  /** Returns the underlying server so a WebSocket server can attach to it. */
  start(): Server;
}

/**
 * Standard wiring for every service, so a new one is routes plus a call to
 * this rather than a hand-copied bootstrap that slowly diverges.
 *
 * Routers are mounted bare. The gateway prefixes /api/v1, so a service never
 * needs to know the public path it is served under.
 */
export function createService(options: ServiceOptions): Service {
  const development = options.development ?? process.env.NODE_ENV === 'development';
  const logger = createLogger(options.name);
  const app = express();

  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb', ...(options.jsonVerify ? { verify: options.jsonVerify as never } : {}) }));
  app.use(requestContext);

  // Structured access log. Deliberately no body: request payloads here carry
  // codes, tokens and clinical text.
  app.use((req, res, next) => {
    res.on('finish', () => {
      const started = res.locals.startedAt as number | undefined;
      logger.info('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: started ? Date.now() - started : undefined,
        requestId: res.locals.requestId,
        userId: req.auth?.sub,
      });
    });
    next();
  });

  app.get('/health', (_req, res) => {
    void (async () => {
      const dependencies: Record<string, string> = {};
      let ok = true;
      try {
        await prisma.$queryRaw`SELECT 1`;
        dependencies.database = 'ok';
      } catch {
        dependencies.database = 'down';
        ok = false;
      }
      for (const [name, probe] of Object.entries(options.healthChecks ?? {})) {
        try {
          dependencies[name] = (await probe()) ? 'ok' : 'down';
        } catch {
          dependencies[name] = 'down';
        }
        if (dependencies[name] !== 'ok') ok = false;
      }
      res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', dependencies });
    })();
  });

  for (const router of options.routers) app.use(router);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger, development));

  return {
    app,
    logger,
    start(): Server {
      const server = app.listen(options.port, options.host ?? '0.0.0.0', () => {
        logger.info('listening', { host: options.host ?? '0.0.0.0', port: options.port });
      });

      // Drain in-flight requests before exiting. Cutting a consultation write
      // in half on deploy is not acceptable.
      for (const signal of ['SIGTERM', 'SIGINT'] as const) {
        process.on(signal, () => {
          logger.info('shutting down', { signal });
          server.close(() => {
            void (async () => {
              await options.onShutdown?.().catch(() => undefined);
              await prisma.$disconnect().catch(() => undefined);
              process.exit(0);
            })();
          });
        });
      }

      return server;
    },
  };
}
