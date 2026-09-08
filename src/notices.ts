export function isRoutineMcpRefreshNotice(message: string, type?: string): boolean {
  return type === 'info' && /^MCP: direct tools refreshed \(\+\d+, ~\d+, -\d+\)$/.test(message);
}
