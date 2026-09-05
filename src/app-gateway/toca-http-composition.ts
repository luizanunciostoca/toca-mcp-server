import { createServer, type Server, type ServerResponse } from 'node:http';
import { createTocaHttpServer, type TocaHttpServerOptions } from '../http-server.js';
import {
  createAppGatewayHttpHandler,
  type AppGatewayHttpOptions,
} from './http-boundary.js';

export interface TocaAppGatewayHttpCompositionOptions {
  readonly toca?: TocaHttpServerOptions;
  readonly appGateway: AppGatewayHttpOptions;
}

/**
 * Composes the PREPARE-only App Gateway in front of the canonical TOCA HTTP server.
 *
 * This is intentionally opt-in. `src/http.ts` does not call this composition until a canonical
 * application-level authorization verifier is selected and validated. When the App Gateway
 * handler declines a request (including missing/disabled authorization), the canonical server
 * remains authoritative and returns its normal response, which is 404 for `/api/v1/*`.
 */
export function createTocaHttpServerWithAppGateway(
  options: TocaAppGatewayHttpCompositionOptions,
): Server {
  const baseServer = createTocaHttpServer(options.toca);
  const appGatewayHandler = createAppGatewayHttpHandler(options.appGateway);

  return createServer((request, response) => {
    void appGatewayHandler(request, response)
      .then((handled) => {
        if (!handled && !response.writableEnded) {
          baseServer.emit('request', request, response);
        }
      })
      .catch((error: unknown) => {
        options.appGateway.onError?.(error);
        if (!response.headersSent) {
          sendCompositionError(response);
          return;
        }
        if (!response.writableEnded) response.end();
      });
  });
}

function sendCompositionError(response: ServerResponse): void {
  const payload = Buffer.from(JSON.stringify({ error: 'APP_GATEWAY_COMPOSITION_FAILED' }));
  response.writeHead(500, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}
