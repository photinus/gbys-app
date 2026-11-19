import "server-only";

/**
 * CONTRACT STUB (workstream FB replaces the file, keeps this signature).
 * System sync of every active SimpleFIN connection (called by the cron route).
 */
export async function syncAllConnections(): Promise<{ connections: number; imported: number; errors: string[] }> {
  return { connections: 0, imported: 0, errors: [] };
}
