import { createAg01HttpServer } from './http-server.js';
import { loadAg01ProductionConfig } from './production-config.js';
import { createAg01ProductionRuntime } from './production-runtime.js';

const config = loadAg01ProductionConfig(process.env);
const runtime = createAg01ProductionRuntime(config, process.env);
const server = createAg01HttpServer(runtime);
let shuttingDown = false;

server.listen(config.port, config.host, () => {
  console.log(
    JSON.stringify({
      severity: 'INFO',
      event: 'ag01.runtime.started',
      timestamp: new Date().toISOString(),
      service: runtime.serviceName,
      version: runtime.serviceVersion,
      host: config.host,
      port: config.port,
      nodeEnv: config.nodeEnv,
      tenantId: config.tenantId,
      runtimeCapabilityCount: runtime.runtimeCapabilityIds.length,
      cloudRunService: process.env.K_SERVICE ?? null,
      cloudRunRevision: process.env.K_REVISION ?? null,
    }),
  );
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(
    JSON.stringify({
      severity: 'INFO',
      event: 'ag01.runtime.stopping',
      timestamp: new Date().toISOString(),
      signal,
    }),
  );
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await runtime.close();
}
