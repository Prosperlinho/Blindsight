export type WalletActivityKind = "query" | "deposit" | "send";

export type WalletActivityDraft = {
  kind: WalletActivityKind;
  amountNear: string;
  title: string;
  txHash?: string;
};

export type WalletActivity = WalletActivityDraft & {
  id: string;
  timestamp: number;
};

const MAX_WALLET_ACTIVITY = 50;

function storageKey(accountId: string) {
  return `blindsight:wallet-activity:${accountId}`;
}

export function getWalletActivity(accountId: string): WalletActivity[] {
  try {
    const stored = localStorage.getItem(storageKey(accountId));
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((entry): entry is WalletActivity => (
      typeof entry === "object"
      && entry !== null
      && "id" in entry
      && typeof entry.id === "string"
      && "kind" in entry
      && (entry.kind === "query" || entry.kind === "deposit" || entry.kind === "send")
      && "amountNear" in entry
      && typeof entry.amountNear === "string"
      && "title" in entry
      && typeof entry.title === "string"
      && "timestamp" in entry
      && typeof entry.timestamp === "number"
      && (!("txHash" in entry) || typeof entry.txHash === "string")
    ));
  } catch {
    return [];
  }
}

export function recordWalletActivity(
  accountId: string,
  activity: WalletActivityDraft,
): WalletActivity[] {
  const current = getWalletActivity(accountId);
  if (activity.txHash && current.some((entry) => entry.txHash === activity.txHash)) {
    return current;
  }

  const next = [
    {
      ...activity,
      id: activity.txHash ?? `${activity.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    },
    ...current,
  ].slice(0, MAX_WALLET_ACTIVITY);

  try {
    localStorage.setItem(storageKey(accountId), JSON.stringify(next));
  } catch {
    return current;
  }

  return next;
}