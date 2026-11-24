"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ExternalLink, LogOut, RefreshCw } from "lucide-react";
import { getAccountExplorerUrl, getTransactionExplorerUrl, nearToYocto, yoctoToNearAmount } from "@/lib/paymentConfig";

type ActivityRow = {
  id: number;
  kind: "query" | "publish" | "unpublish";
  account_id: string;
  vault_id: string | null;
  vault_title: string | null;
  receiver_id: string | null;
  amount_near: string | null;
  payment_tx: string | null;
  fee_near: string | null;
  fee_tx: string | null;
  created_at: string;
};

type VaultRow = {
  id: string;
  title: string;
  price: string;
  publisher_address: string;
  payout_address: string;
  file_reference: string;
  publish_fee_tx?: string | null;
  created_at: string;
};

type AdminData = {
  treasury: string;
  logReady: boolean;
  activity: ActivityRow[];
  vaults: VaultRow[];
};

type Tab = "activity" | "vaults" | "publishers";
type KindFilter = "all" | ActivityRow["kind"];

const SESSION_KEY = "blindsight:admin-password";
const KIND_LABELS: Record<ActivityRow["kind"], string> = { query: "Paid question", publish: "Upload", unpublish: "Removed" };

function yocto(value: string | null | undefined): bigint {
  if (!value) return BigInt(0);
  try {
    return nearToYocto(value);
  } catch {
    return BigInt(0);
  }
}

function near(value: bigint) {
  return `${yoctoToNearAmount(value)} NEAR`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function shortHash(hash: string) {
  return hash.length > 14 ? `${hash.slice(0, 6)}…${hash.slice(-6)}` : hash;
}

function TxLink({ hash }: { hash: string | null | undefined }) {
  if (!hash) return <span className="text-slate-600">—</span>;
  return (
    <a href={getTransactionExplorerUrl(hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-emerald-300 hover:underline">
      {shortHash(hash)} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function AccountLink({ account }: { account: string | null | undefined }) {
  if (!account) return <span className="text-slate-600">—</span>;
  return (
    <a href={getAccountExplorerUrl(account)} target="_blank" rel="noreferrer" className="hover:text-emerald-300 hover:underline">
      {account}
    </a>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-white">{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("activity");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async (secret: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/activity", {
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) sessionStorage.removeItem(SESSION_KEY);
        setData(null);
        setError(typeof body.error === "string" ? body.error : "Couldn't load admin data.");
        return;
      }
      sessionStorage.setItem(SESSION_KEY, secret);
      setData(body as AdminData);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    // Restore the session after mount (sessionStorage only exists in the browser).
    if (saved) void Promise.resolve().then(() => load(saved));
  }, [load]);

  function signIn(event: FormEvent) {
    event.preventDefault();
    if (password) void load(password);
  }

  function signOut() {
    sessionStorage.removeItem(SESSION_KEY);
    setData(null);
    setPassword("");
  }

  const summary = useMemo(() => {
    if (!data) return null;
    const queries = data.activity.filter((row) => row.kind === "query");
    const uploads = data.activity.filter((row) => row.kind === "publish");
    let toPublishers = BigInt(0);
    let platform = BigInt(0);
    let buyerSpend = BigInt(0);
    for (const row of queries) {
      const amount = yocto(row.amount_near);
      const fee = yocto(row.fee_near);
      buyerSpend += amount + fee;
      platform += fee;
      if (row.receiver_id === data.treasury) platform += amount;
      else toPublishers += amount;
    }
    for (const row of uploads) platform += yocto(row.fee_near);
    return {
      questions: queries.length,
      buyers: new Set(queries.map((row) => row.account_id)).size,
      buyerSpend,
      toPublishers,
      platform,
      uploads: uploads.length,
      removed: data.activity.filter((row) => row.kind === "unpublish").length,
    };
  }, [data]);

  const vaultStats = useMemo(() => {
    if (!data) return [];
    const live = new Map(data.vaults.map((vault) => [vault.id, vault]));
    const stats = new Map<string, { id: string; title: string; publisher: string; payout: string; price: string; createdAt: string | null; live: boolean; publishTx: string | null; questions: number; earned: bigint }>();
    const ensure = (id: string, title: string, publisher: string) => {
      let entry = stats.get(id);
      if (!entry) {
        const vault = live.get(id);
        entry = {
          id,
          title: vault?.title ?? title,
          publisher: vault?.publisher_address ?? publisher,
          payout: vault?.payout_address ?? "",
          price: vault?.price ?? "",
          createdAt: vault?.created_at ?? null,
          live: Boolean(vault),
          publishTx: vault?.publish_fee_tx ?? null,
          questions: 0,
          earned: BigInt(0),
        };
        stats.set(id, entry);
      }
      return entry;
    };
    for (const vault of data.vaults) ensure(vault.id, vault.title, vault.publisher_address);
    for (const row of data.activity) {
      if (!row.vault_id) continue;
      const entry = ensure(row.vault_id, row.vault_title ?? row.vault_id, row.kind === "query" ? "" : row.account_id);
      if (row.kind === "publish") {
        entry.publishTx ??= row.fee_tx;
        entry.createdAt ??= row.created_at;
        if (!entry.publisher) entry.publisher = row.account_id;
      }
      if (row.kind === "query") {
        entry.questions += 1;
        entry.earned += yocto(row.amount_near);
        if (!entry.payout && row.receiver_id) entry.payout = row.receiver_id;
      }
    }
    return [...stats.values()].sort((a, b) => b.questions - a.questions || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }, [data]);

  const publisherStats = useMemo(() => {
    const totals = new Map<string, { publisher: string; vaults: number; live: number; questions: number; earned: bigint }>();
    for (const vault of vaultStats) {
      const key = vault.publisher || "(sample vaults)";
      const entry = totals.get(key) ?? { publisher: key, vaults: 0, live: 0, questions: 0, earned: BigInt(0) };
      entry.vaults += 1;
      if (vault.live) entry.live += 1;
      entry.questions += vault.questions;
      entry.earned += vault.earned;
      totals.set(key, entry);
    }
    return [...totals.values()].sort((a, b) => (b.earned > a.earned ? 1 : b.earned < a.earned ? -1 : b.vaults - a.vaults));
  }, [vaultStats]);

  const filteredActivity = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    return data.activity.filter((row) => (
      (kindFilter === "all" || row.kind === kindFilter)
      && (!needle || [row.account_id, row.vault_title, row.vault_id, row.receiver_id, row.payment_tx, row.fee_tx]
        .some((value) => value?.toLowerCase().includes(needle)))
    ));
  }, [data, kindFilter, search]);

  if (!data) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <form onSubmit={signIn} className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h1 className="text-lg font-semibold text-white">BlindSight admin</h1>
          <p className="mt-1 text-sm text-slate-400">Uploads and on-chain payments across the platform.</p>
          <label className="mt-5 block text-xs text-slate-400" htmlFor="admin-password">Admin password</label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
          />
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="mt-4 w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            {loading ? "Checking…" : "Sign in"}
          </button>
        </form>
      </main>
    );
  }

  const tabClass = (value: Tab) => `rounded-lg px-3 py-1.5 text-sm ${tab === value ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Admin</h1>
          <p className="text-sm text-slate-400">
            Treasury <AccountLink account={data.treasury} /> · NEAR testnet
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load(sessionStorage.getItem(SESSION_KEY) ?? password)} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:text-white disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button onClick={signOut} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:text-white">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>

      {!data.logReady && (
        <p className="mt-6 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
          The activity log table doesn&apos;t exist yet. Run <code>supabase/schema.sql</code> in the Supabase SQL editor. Live vaults are shown below.
        </p>
      )}
      {error && <p className="mt-6 text-sm text-red-400">{error}</p>}

      {summary && (
        <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Paid questions answered" value={String(summary.questions)} note={`${summary.buyers} distinct buyers`} />
          <Stat label="Total buyer spend" value={near(summary.buyerSpend)} note="Vault prices + platform fees" />
          <Stat label="Paid to publishers" value={near(summary.toPublishers)} />
          <Stat label="Platform revenue" value={near(summary.platform)} note="Fees + sample-vault sales" />
          <Stat label="Uploads logged" value={String(summary.uploads)} />
          <Stat label="Live vaults" value={String(data.vaults.length)} />
          <Stat label="Vaults removed" value={String(summary.removed)} />
          <Stat label="Publishers" value={String(publisherStats.filter((p) => p.publisher !== "(sample vaults)").length)} />
        </section>
      )}

      <nav className="mt-8 flex gap-1">
        <button className={tabClass("activity")} onClick={() => setTab("activity")}>Activity</button>
        <button className={tabClass("vaults")} onClick={() => setTab("vaults")}>Vaults</button>
        <button className={tabClass("publishers")} onClick={() => setTab("publishers")}>Publishers</button>
      </nav>

      <section className="mt-4 overflow-x-auto rounded-xl border border-white/10">
        {tab === "activity" && (
          <>
            <div className="flex flex-wrap gap-2 border-b border-white/10 p-3">
              <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as KindFilter)} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white">
                <option value="all">All events</option>
                <option value="query">Paid questions</option>
                <option value="publish">Uploads</option>
                <option value="unpublish">Removed</option>
              </select>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search account, vault or tx"
                className="min-w-56 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white outline-none"
              />
            </div>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-400">
                <tr className="border-b border-white/10">
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Vault</th>
                  <th className="px-3 py-2 font-medium">Paid to</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Payment tx</th>
                  <th className="px-3 py-2 text-right font-medium">Fee</th>
                  <th className="px-3 py-2 font-medium">Fee tx</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {filteredActivity.map((row) => (
                  <tr key={row.id} className="border-b border-white/5 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-400">{formatDate(row.created_at)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{KIND_LABELS[row.kind]}</td>
                    <td className="px-3 py-2"><AccountLink account={row.account_id} /></td>
                    <td className="max-w-48 truncate px-3 py-2" title={row.vault_id ?? undefined}>{row.vault_title ?? row.vault_id ?? "—"}</td>
                    <td className="px-3 py-2"><AccountLink account={row.kind === "query" ? row.receiver_id : null} /></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{row.amount_near ? `${row.amount_near} NEAR` : "—"}</td>
                    <td className="px-3 py-2"><TxLink hash={row.payment_tx} /></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{row.fee_near ? `${row.fee_near} NEAR` : "—"}</td>
                    <td className="px-3 py-2"><TxLink hash={row.fee_tx} /></td>
                  </tr>
                ))}
                {filteredActivity.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500">No activity logged yet.</td></tr>
                )}
              </tbody>
            </table>
          </>
        )}

        {tab === "vaults" && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 font-medium">Vault</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Publisher</th>
                <th className="px-3 py-2 font-medium">Payout</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Questions</th>
                <th className="px-3 py-2 text-right font-medium">Earned</th>
                <th className="px-3 py-2 font-medium">Uploaded</th>
                <th className="px-3 py-2 font-medium">Publish fee tx</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {vaultStats.map((vault) => (
                <tr key={vault.id} className="border-b border-white/5 last:border-0">
                  <td className="max-w-56 truncate px-3 py-2" title={vault.id}>{vault.title}</td>
                  <td className="px-3 py-2">
                    <span className={vault.live ? "text-emerald-300" : "text-slate-500"}>
                      {vault.live ? "Live" : vault.publisher ? "Removed" : "Sample"}
                    </span>
                  </td>
                  <td className="px-3 py-2"><AccountLink account={vault.publisher || null} /></td>
                  <td className="px-3 py-2"><AccountLink account={vault.payout || null} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{vault.price ? `${vault.price} NEAR` : "—"}</td>
                  <td className="px-3 py-2 text-right">{vault.questions}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{near(vault.earned)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-400">{vault.createdAt ? formatDate(vault.createdAt) : "—"}</td>
                  <td className="px-3 py-2"><TxLink hash={vault.publishTx} /></td>
                </tr>
              ))}
              {vaultStats.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500">No vaults yet.</td></tr>
              )}
            </tbody>
          </table>
        )}

        {tab === "publishers" && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 font-medium">Publisher</th>
                <th className="px-3 py-2 text-right font-medium">Vaults</th>
                <th className="px-3 py-2 text-right font-medium">Live</th>
                <th className="px-3 py-2 text-right font-medium">Questions</th>
                <th className="px-3 py-2 text-right font-medium">Earned</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {publisherStats.map((entry) => (
                <tr key={entry.publisher} className="border-b border-white/5 last:border-0">
                  <td className="px-3 py-2">
                    {entry.publisher === "(sample vaults)" ? <span className="text-slate-400">Sample vaults (treasury)</span> : <AccountLink account={entry.publisher} />}
                  </td>
                  <td className="px-3 py-2 text-right">{entry.vaults}</td>
                  <td className="px-3 py-2 text-right">{entry.live}</td>
                  <td className="px-3 py-2 text-right">{entry.questions}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{near(entry.earned)}</td>
                </tr>
              ))}
              {publisherStats.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No publishers yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      <p className="mt-4 text-xs text-slate-500">
        Every logged payment was verified on chain before the answer was released. Entries start from when the activity log
        was set up; earlier payments are in the treasury history on NearBlocks. Shows the latest 1,000 events.
      </p>
    </main>
  );
}
