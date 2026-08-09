import { describe, expect, it } from 'vitest';
import { SERVER_NAME, SERVER_VERSION, createTocaServer } from '../src/server.js';

describe('TOCA MCP bootstrap', () => {
  it('exposes stable server metadata', () => {
    expect(SERVER_NAME).toBe('toca-mcp-server');
    expect(SERVER_VERSION).toBe('0.1.0');
    expect(createTocaServer()).toBeDefined();
  });
});
