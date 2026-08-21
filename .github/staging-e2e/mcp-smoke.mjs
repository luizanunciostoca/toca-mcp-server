import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const mcpUrl = process.env.MCP_URL;
const mcpToken = process.env.MCP_TOKEN;
const evidenceDir = process.env.EVIDENCE_DIR;
if (!mcpUrl) throw new Error("STAGING_E2E_MCP_URL_REQUIRED");
if (!mcpToken) throw new Error("STAGING_E2E_MCP_TOKEN_REQUIRED");
if (!evidenceDir) throw new Error("STAGING_E2E_EVIDENCE_DIR_REQUIRED");

const client = new Client(
  { name: "toca-staging-e2e", version: "1.0.0" },
  { versionNegotiation: { mode: "auto" } },
);
const transport = new StreamableHTTPClientTransport(new URL(`${mcpUrl}/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } },
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  assert(
    names.includes("toca.system.health"),
    "STAGING_E2E_HEALTH_TOOL_MISSING",
  );
  assert(
    names.includes("toca.capabilities.search"),
    "STAGING_E2E_CAPABILITY_SEARCH_TOOL_MISSING",
  );

  const health = await client.callTool({
    name: "toca.system.health",
    arguments: {},
  });
  assert.notEqual(health.isError, true, "STAGING_E2E_HEALTH_TOOL_ERROR");
  const search = await client.callTool({
    name: "toca.capabilities.search",
    arguments: { query: "whatsapp", limit: 20 },
  });
  assert.notEqual(search.isError, true, "STAGING_E2E_CAPABILITY_SEARCH_ERROR");

  const summary = {
    schemaVersion: "toca.staging.e2e.mcp-smoke.v1",
    transport: "streamable-http",
    authenticated: true,
    toolCount: names.length,
    requiredTools: ["toca.system.health", "toca.capabilities.search"],
    healthCall: "PASS",
    capabilitySearchCall: "PASS",
    sideEffectingToolCalled: false,
    providerMutation: "NO",
    result: "PASS",
  };
  await writeFile(
    join(evidenceDir, "mcp-protocol-smoke.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(JSON.stringify(summary));
} finally {
  await client.close().catch(() => undefined);
}
