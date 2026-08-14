import { describe, expect, it } from 'vitest';
import { SERVER_NAME, SERVER_VERSION, createTocaServer } from '../src/server.js';

describe('TOCA MCP production foundation', () => {
  it('exposes stable server metadata', () => {
    expect(SERVER_NAME).toBe('toca-mcp-server');
    expect(SERVER_VERSION).toBe('0.2.0');
    expect(createTocaServer()).toBeDefined();
  });
});
