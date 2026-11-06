export type AuditLogEntry = {
  id: string;
  message: string;
  timestamp: string;
  /** NEAR testnet transaction hash, rendered as a NearBlocks explorer link. */
  txHash?: string;
};

export function createAuditLogEntry(message: string, txHash?: string): AuditLogEntry {
  return {
    id: window.crypto.randomUUID(),
    message,
    timestamp: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    ...(txHash ? { txHash } : {}),
  };
}
