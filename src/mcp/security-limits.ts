// Preserve the SDK's existing 4 MiB HTTP envelope, including inline asset data.
// This bound applies only to MCP, not health checks or Meta webhook ingress.
export const MCP_MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;

// Core workflows allow 200 steps with 100 dependencies each: over 20,000
// aggregate members/elements before step metadata. 32,768 accommodates that
// bounded shape with headroom while bounding otherwise open-ended tool input.
// The SDK counts object members and array elements, not string characters.
export const MCP_MAX_TOOL_INPUT_ELEMENTS = 32_768;

// Readonly exposes only health and catalog search/describe. Its bounded query,
// provider and capability ID strings fit well below 1 KiB; leave framing headroom.
export const MCP_READONLY_MAX_REQUEST_BODY_BYTES = 64 * 1024;
