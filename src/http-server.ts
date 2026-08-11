import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { toNodeHandler, type NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { evaluateReadiness, type ReadinessCheck } from './health/readiness.js';
import type { InstagramWebhookEvent } from './providers/instagram/instagram-engagement-contracts.js';
import type { MetaManagedAsset } from './providers/meta/meta-assets.js';
import type { MetaTokenExchangeResult } from './providers/meta/meta-connection.js';
import type { MetaOAuthService } from './providers/meta/meta-oauth.js';
import {
  parseMetaWebhookEvents,
  verifyMetaWebhookChallenge,
  verifyMetaWebhookSignature,
} from './providers/meta/meta-webhook.js';
import { createTocaServer, SERVER_NAME, SERVER_VERSION } from './server.js';

const MAX_META_WEBHOOK_BODY_BYTES = 1024 * 1024;
const COMPLIANCE_CONTACT_EMAIL = 'adm@tocadomorcego.com';
const COMPLIANCE_LAST_UPDATED = '11 de agosto de 2026';

export interface MetaWebhookHttpBoundary {
  resolveVerifyToken(): Promise<string>;
  resolveAppSecret(): Promise<string>;
  onEvents?: (events: readonly InstagramWebhookEvent[]) => Promise<void> | void;
}

export interface TocaHttpServerOptions {
  readonly onError?: (error: unknown) => void;
  readonly readinessChecks?: readonly ReadinessCheck[];
  readonly metaOAuth?: MetaOAuthService;
  readonly metaAssetDiscovery?: (
    result: MetaTokenExchangeResult,
  ) => Promise<readonly MetaManagedAsset[]>;
  readonly metaWebhook?: MetaWebhookHttpBoundary;
  readonly mcpEnabled?: boolean;
}

export function createTocaHttpServer(options: TocaHttpServerOptions = {}): Server {
  const mcp = createMcpHandler(() => createTocaServer());
  const handleMcp = toNodeHandler(mcp, {
    onerror: (error) => {
      options.onError?.(error);
    },
  });

  return createServer((request, response) => {
    const requestUrl = request.url ?? '/';
    const method = request.method ?? 'POST';
    const url = new URL(requestUrl, `http://${request.headers.host ?? 'localhost'}`);

    if ((url.pathname === '/healthz' || url.pathname === '/health') && method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ status: 'ok', service: SERVER_NAME, version: SERVER_VERSION }));
      return;
    }

    if (url.pathname === '/readyz' && method === 'GET') {
      void evaluateReadiness(options.readinessChecks ?? []).then((report) => {
        response.writeHead(report.status === 'ready' ? 200 : 503, {
          'content-type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify(report));
      });
      return;
    }

    if (method === 'GET') {
      const compliancePage = compliancePageForPath(url.pathname);
      if (compliancePage) {
        writeCompliancePage(response, compliancePage);
        return;
      }
    }

    if (url.pathname === '/webhooks/meta' && method === 'GET' && options.metaWebhook) {
      void handleMetaWebhookChallenge(url, response, options).catch((error: unknown) => {
        options.onError?.(error);
        if (!response.headersSent) {
          response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        }
        if (!response.writableEnded) {
          response.end(JSON.stringify({ error: 'meta_webhook_verification_failed' }));
        }
      });
      return;
    }

    if (url.pathname === '/webhooks/meta' && method === 'POST' && options.metaWebhook) {
      void handleMetaWebhookEvent(request, response, options).catch((error: unknown) => {
        options.onError?.(error);
        if (!response.headersSent) {
          const status = error instanceof MetaWebhookBodyTooLargeError ? 413 : 400;
          response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        }
        if (!response.writableEnded) {
          response.end(JSON.stringify({ error: 'invalid_meta_webhook_event' }));
        }
      });
      return;
    }

    if (url.pathname === '/oauth/meta/start' && method === 'GET' && options.metaOAuth) {
      void options.metaOAuth
        .beginAuthorization()
        .then((authorization) => {
          response.writeHead(302, {
            location: authorization.authorizationUrl,
            'cache-control': 'no-store',
          });
          response.end();
        })
        .catch((error: unknown) => {
          options.onError?.(error);
          response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'meta_oauth_start_failed' }));
        });
      return;
    }

    if (url.pathname === '/oauth/meta/callback' && method === 'GET' && options.metaOAuth) {
      const providerError = url.searchParams.get('error');
      if (providerError) {
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'meta_oauth_denied', providerError }));
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) {
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'invalid_meta_oauth_callback' }));
        return;
      }

      void options.metaOAuth
        .completeAuthorization({ code, state })
        .then(async (result) => {
          const assets = options.metaAssetDiscovery
            ? await options.metaAssetDiscovery(result)
            : undefined;
          response.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          response.end(
            JSON.stringify({
              status: 'connected',
              grantedScopes: result.grantedScopes,
              ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
              ...(assets ? { assets } : {}),
            }),
          );
        })
        .catch((error: unknown) => {
          options.onError?.(error);
          response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'meta_oauth_callback_failed' }));
        });
      return;
    }

    if (url.pathname !== '/mcp' || options.mcpEnabled === false) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    const normalizedRequest: NodeIncomingMessageLike = {
      method,
      url: requestUrl,
      headers: request.headers,
      [Symbol.asyncIterator]: () => request[Symbol.asyncIterator](),
    };

    void handleMcp(normalizedRequest, response).catch((error: unknown) => {
      options.onError?.(error);
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      }
      if (!response.writableEnded) {
        response.end(JSON.stringify({ error: 'mcp_request_failed' }));
      }
    });
  });
}

interface CompliancePage {
  readonly title: string;
  readonly description: string;
  readonly sections: readonly {
    readonly heading: string;
    readonly paragraphs: readonly string[];
    readonly items?: readonly string[];
  }[];
}

function compliancePageForPath(pathname: string): CompliancePage | undefined {
  if (pathname === '/privacy') return privacyPage();
  if (pathname === '/terms') return termsPage();
  if (pathname === '/data-deletion') return dataDeletionPage();
  return undefined;
}

function privacyPage(): CompliancePage {
  return {
    title: 'Política de Privacidade — TOCA MCP',
    description:
      'Esta Política de Privacidade descreve como o TOCA MCP, operado para a Toca do Morcego, trata dados ao integrar serviços da Meta, incluindo Facebook e Instagram.',
    sections: [
      {
        heading: '1. Dados tratados',
        paragraphs: [
          'O TOCA MCP trata apenas os dados necessários às funcionalidades autorizadas pela conta conectada e às permissões concedidas pela Meta.',
        ],
        items: [
          'Identificadores da Página do Facebook e da conta profissional do Instagram conectadas.',
          'Metadados de perfil e conteúdo necessários para identificar e administrar os ativos autorizados.',
          'Comentários, mensagens e metadados de interação quando essas permissões forem concedidas e o recurso estiver habilitado.',
          'Tokens de acesso e informações técnicas de autorização necessárias para manter a integração, armazenados em infraestrutura protegida e não exibidos publicamente.',
          'Registros técnicos mínimos para segurança, auditoria, diagnóstico e prevenção de uso indevido.',
        ],
      },
      {
        heading: '2. Finalidades',
        paragraphs: ['Os dados são utilizados exclusivamente para:'],
        items: [
          'Conectar e identificar os ativos empresariais autorizados da Toca do Morcego.',
          'Ler e administrar interações autorizadas, como comentários e mensagens, conforme as permissões concedidas.',
          'Operar, proteger, auditar e diagnosticar a integração.',
          'Cumprir obrigações legais, regulatórias e requisitos das plataformas Meta aplicáveis.',
        ],
      },
      {
        heading: '3. Compartilhamento e venda',
        paragraphs: [
          'O TOCA MCP não vende dados pessoais. Dados podem ser processados por provedores de infraestrutura estritamente necessários à operação segura do serviço e pelas próprias plataformas Meta conforme seus termos e políticas.',
        ],
      },
      {
        heading: '4. Retenção e segurança',
        paragraphs: [
          'Os dados são mantidos somente pelo período necessário às finalidades descritas, às obrigações legais e à segurança operacional. Credenciais e segredos são protegidos por controles de acesso e mecanismos próprios de gerenciamento de segredos. Registros operacionais evitam, sempre que possível, conteúdo sensível e tokens de acesso.',
        ],
      },
      {
        heading: '5. Direitos e exclusão de dados',
        paragraphs: [
          'Solicitações relacionadas a acesso, correção ou exclusão podem ser encaminhadas ao contato abaixo. Instruções específicas de exclusão estão disponíveis em /data-deletion.',
        ],
      },
      {
        heading: '6. Contato',
        paragraphs: [`E-mail: ${COMPLIANCE_CONTACT_EMAIL}`],
      },
    ],
  };
}

function termsPage(): CompliancePage {
  return {
    title: 'Termos de Serviço — TOCA MCP',
    description:
      'Estes Termos regem o uso do TOCA MCP, uma integração operacional da Toca do Morcego com serviços autorizados da Meta.',
    sections: [
      {
        heading: '1. Uso autorizado',
        paragraphs: [
          'O serviço deve ser utilizado somente por pessoas autorizadas a administrar os ativos conectados e em conformidade com as políticas da Meta e com a legislação aplicável.',
        ],
      },
      {
        heading: '2. Permissões e contas conectadas',
        paragraphs: [
          'O acesso depende das permissões concedidas pela Meta e pelos administradores dos ativos. Permissões podem ser revogadas a qualquer momento, o que pode limitar ou interromper funcionalidades relacionadas.',
        ],
      },
      {
        heading: '3. Segurança e uso indevido',
        paragraphs: [
          'É proibido tentar obter acesso não autorizado, contornar controles de segurança, usar credenciais de terceiros ou utilizar o serviço para spam, abuso, fraude ou qualquer finalidade ilegal.',
        ],
      },
      {
        heading: '4. Disponibilidade',
        paragraphs: [
          'O serviço depende de APIs e plataformas de terceiros. Funcionalidades podem ser alteradas, suspensas ou indisponíveis em razão de mudanças nessas plataformas, manutenção ou requisitos de segurança.',
        ],
      },
      {
        heading: '5. Privacidade',
        paragraphs: ['O tratamento de dados é descrito na Política de Privacidade disponível em /privacy.'],
      },
      {
        heading: '6. Contato',
        paragraphs: [`E-mail: ${COMPLIANCE_CONTACT_EMAIL}`],
      },
    ],
  };
}

function dataDeletionPage(): CompliancePage {
  return {
    title: 'Exclusão de Dados — TOCA MCP',
    description:
      'Esta página explica como solicitar a exclusão de dados associados ao TOCA MCP e à integração da Toca do Morcego com a Meta.',
    sections: [
      {
        heading: '1. Como solicitar',
        paragraphs: [
          `Envie um e-mail para ${COMPLIANCE_CONTACT_EMAIL} com o assunto “Exclusão de dados — TOCA MCP”.`,
          'Inclua informações suficientes para localizar a integração ou o ativo relacionado, sem enviar senhas, tokens de acesso ou outros segredos.',
        ],
      },
      {
        heading: '2. O que acontece após a solicitação',
        paragraphs: [
          'A solicitação será validada para evitar exclusões indevidas. Quando aplicável, dados sob controle do TOCA MCP serão eliminados ou anonimizados, salvo quando a retenção for necessária por obrigação legal, segurança ou exercício regular de direitos.',
        ],
      },
      {
        heading: '3. Revogação do acesso da Meta',
        paragraphs: [
          'O acesso do aplicativo também pode ser revogado nas configurações da conta, Página ou portfólio empresarial da Meta. A revogação impede novos acessos por meio das credenciais correspondentes, mas não substitui uma solicitação de exclusão quando houver dados que devam ser removidos dos sistemas sob controle do TOCA MCP.',
        ],
      },
      {
        heading: '4. Contato',
        paragraphs: [`E-mail: ${COMPLIANCE_CONTACT_EMAIL}`],
      },
    ],
  };
}

function writeCompliancePage(response: ServerResponse, page: CompliancePage): void {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    'referrer-policy': 'no-referrer',
  });
  response.end(renderCompliancePage(page));
}

function renderCompliancePage(page: CompliancePage): string {
  const sections = page.sections
    .map((section) => {
      const paragraphs = section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('');
      const items = section.items
        ? `<ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : '';
      return `<section><h2>${escapeHtml(section.heading)}</h2>${paragraphs}${items}</section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(page.title)}</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171717;background:#fafafa}body{margin:0}main{max-width:760px;margin:0 auto;padding:56px 24px 72px}h1{font-size:clamp(2rem,6vw,3.25rem);line-height:1.05;margin:0 0 20px}h2{font-size:1.2rem;margin:36px 0 12px}p,li{font-size:1rem;line-height:1.7;color:#404040}ul{padding-left:22px}.eyebrow{font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:#666}.updated{margin-top:48px;padding-top:18px;border-top:1px solid #ddd;font-size:.9rem;color:#666}a{color:inherit}
</style>
</head>
<body>
<main>
<p class="eyebrow">Toca do Morcego · TOCA MCP</p>
<h1>${escapeHtml(page.title)}</h1>
<p>${escapeHtml(page.description)}</p>
${sections}
<p class="updated">Última atualização: ${COMPLIANCE_LAST_UPDATED}</p>
</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function handleMetaWebhookChallenge(
  url: URL,
  response: ServerResponse,
  options: TocaHttpServerOptions,
): Promise<void> {
  const expectedVerifyToken = await options.metaWebhook!.resolveVerifyToken();
  const result = verifyMetaWebhookChallenge(
    {
      mode: url.searchParams.get('hub.mode'),
      verifyToken: url.searchParams.get('hub.verify_token'),
      challenge: url.searchParams.get('hub.challenge'),
    },
    expectedVerifyToken,
  );

  if (!result.accepted || !result.challenge) {
    response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'meta_webhook_verification_rejected' }));
    return;
  }

  response.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(result.challenge);
}

async function handleMetaWebhookEvent(
  request: IncomingMessage,
  response: ServerResponse,
  options: TocaHttpServerOptions,
): Promise<void> {
  const rawBody = await readRequestBody(request, MAX_META_WEBHOOK_BODY_BYTES);
  const signature = headerValue(request.headers['x-hub-signature-256']);
  const appSecret = await options.metaWebhook!.resolveAppSecret();

  if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
    response.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'invalid_meta_webhook_signature' }));
    return;
  }

  const events = parseMetaWebhookEvents(rawBody);
  await options.metaWebhook!.onEvents?.(events);

  response.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end('EVENT_RECEIVED');
}

function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    request.on('data', (chunk: unknown) => {
      if (settled) return;

      const buffer = toBodyBuffer(chunk);
      if (!buffer) {
        settled = true;
        reject(new Error('Unsupported Meta webhook body chunk'));
        return;
      }

      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        settled = true;
        reject(new MetaWebhookBodyTooLargeError());
        return;
      }
      chunks.push(buffer);
    });

    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, totalBytes));
    });

    request.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function toBodyBuffer(chunk: unknown): Buffer | undefined {
  if (typeof chunk === 'string') return Buffer.from(chunk);
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return undefined;
}

function headerValue(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (value === undefined) return undefined;
  return value[0];
}

class MetaWebhookBodyTooLargeError extends Error {
  constructor() {
    super('Meta webhook request body is too large');
  }
}
