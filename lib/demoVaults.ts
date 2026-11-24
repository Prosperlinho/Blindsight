/**
 * Sample vault catalog shared by the marketplace UI and the query API.
 *
 * This file contains metadata only. The actual sample datasets live in
 * `lib/demoVaultDatasets.ts`, which is imported exclusively by server code, so
 * the "private" sample rows are never shipped to the browser bundle.
 *
 * Sample listings are labelled as samples. Each one's question price goes to
 * the account in SAMPLE_PAYOUTS, or to the BlindSight treasury when none is
 * set. The 0.01 NEAR platform fee always goes to the treasury.
 */

import { DEFAULT_TREASURY_ACCOUNT } from "@/lib/paymentConfig";

/**
 * Payout account per sample vault (NEAR testnet). Leave a vault out to pay the
 * treasury. Changing this needs a redeploy; the server checks every payment
 * against the account listed here.
 */
const SAMPLE_PAYOUTS: Record<string, string> = {
  // "defi-lending-pool-risk": "example.testnet",
};

function samplePayout(vaultId: string): string {
  return SAMPLE_PAYOUTS[vaultId]?.trim() || DEFAULT_TREASURY_ACCOUNT;
}

export type MarketplaceVault = {
  id: string;
  title: string;
  description: string;
  category: string;
  /**
   * Real NEAR account that would receive publisher payouts. Sample listings
   * use the BlindSight treasury because their publishers are fictional.
   */
  seller: string;
  priceNear: string;
  /** Row count of the sample dataset served to inference. */
  rows: number;
  /** Display descriptor for the listing's last update. */
  updated: string;
  /** Raw dataset for legacy in-session listings; never included in shared listings. */
  dataset?: string;
  publisherAddress?: string;
  createdAt?: number;
  source: "sample" | "session" | "published";
  sampleColumns?: string[];
};

export const DEMO_VAULTS: MarketplaceVault[] = [
  {
    id: "q3-financial-market-demand",
    title: "Q3 Financial & Market Demand",
    description:
      "Example quarterly revenue, retention, and demand trends across customer segments.",
    category: "Finance",
    seller: samplePayout("q3-financial-market-demand"),
    priceNear: "0.15",
    rows: 16,
    updated: "static sample snapshot",
    source: "sample",
    sampleColumns: [
      "quarter",
      "segment",
      "revenue_usd",
      "yoy_growth_pct",
      "net_revenue_retention_pct",
      "churn_pct",
    ],
  },
  {
    id: "medical-research-cohort-2026",
    title: "Medical Research Cohort 2026",
    description:
      "Example cohort outcomes, biomarker signals, and adverse-event rates across multiple sites.",
    category: "Health",
    seller: samplePayout("medical-research-cohort-2026"),
    priceNear: "0.1",
    rows: 14,
    updated: "static sample snapshot",
    source: "sample",
    sampleColumns: [
      "site_id",
      "cohort",
      "participants",
      "primary_endpoint_reduction_pct",
      "adverse_event_rate_pct",
      "il6_baseline_pg_ml",
    ],
  },
  {
    id: "solidity-security-audit-report",
    title: "Solidity Security Audit Report",
    description:
      "Example open and resolved findings, coverage, and risk patterns from a DeFi security audit.",
    category: "Security",
    seller: samplePayout("solidity-security-audit-report"),
    priceNear: "0.2",
    rows: 15,
    updated: "static sample snapshot",
    source: "sample",
    sampleColumns: [
      "finding_id",
      "severity",
      "contract",
      "status",
      "category",
      "description",
    ],
  },
  {
    id: "defi-lending-pool-risk",
    title: "DeFi Lending Pool Risk Monitor",
    description:
      "Utilization, APYs, liquidations and bad debt across 14 lending pools, with oracle setup per asset.",
    category: "DeFi",
    seller: samplePayout("defi-lending-pool-risk"),
    priceNear: "0.15",
    rows: 14,
    updated: "static sample snapshot",
    source: "sample",
    sampleColumns: [
      "pool",
      "asset",
      "tvl_usd",
      "utilization_pct",
      "liquidations_30d",
      "bad_debt_usd",
    ],
  },
  {
    id: "validator-node-performance",
    title: "Validator Node Performance",
    description:
      "Uptime, produced vs expected blocks, missed chunks and client versions for 14 validator nodes.",
    category: "Infrastructure",
    seller: samplePayout("validator-node-performance"),
    priceNear: "0.1",
    rows: 14,
    updated: "static sample snapshot",
    source: "sample",
    sampleColumns: [
      "node_id",
      "region",
      "stake_near",
      "uptime_pct",
      "chunks_missed",
      "client_version",
    ],
  },
  {
    id: "regional-retail-sales",
    title: "Regional Retail Sales & Inventory",
    description:
      "Three months of revenue, units, returns, stockouts and promo share by region and category.",
    category: "Retail",
    seller: samplePayout("regional-retail-sales"),
    priceNear: "0.12",
    rows: 15,
    updated: "static sample snapshot",
    source: "sample",
    sampleColumns: [
      "month",
      "region",
      "category",
      "revenue_usd",
      "return_rate_pct",
      "stockout_days",
    ],
  },
  {
    id: "saas-feature-adoption",
    title: "SaaS Feature Adoption & Retention",
    description:
      "Weekly active accounts, adoption, 30-day retention and NPS per feature and plan tier.",
    category: "Product",
    seller: samplePayout("saas-feature-adoption"),
    priceNear: "0.1",
    rows: 14,
    updated: "static sample snapshot",
    source: "sample",
    sampleColumns: [
      "feature",
      "plan_tier",
      "weekly_active_accounts",
      "adoption_pct",
      "day30_retention_pct",
      "nps",
    ],
  },
  {
    id: "supply-chain-lane-performance",
    title: "Supply Chain Lane Performance",
    description:
      "On-time rate, delays, damage, cost and emissions across 14 ocean, air, road and rail lanes.",
    category: "Logistics",
    seller: samplePayout("supply-chain-lane-performance"),
    priceNear: "0.12",
    rows: 14,
    updated: "static sample snapshot",
    source: "sample",
    sampleColumns: [
      "lane",
      "mode",
      "on_time_pct",
      "avg_delay_hours",
      "cost_per_kg_usd",
      "primary_delay_cause",
    ],
  },
  {
    id: "soc-incident-summary",
    title: "SOC Security Incident Summary",
    description:
      "Three months of security incidents: attack vector, detection time, containment time and root cause.",
    category: "Security",
    seller: samplePayout("soc-incident-summary"),
    priceNear: "0.2",
    rows: 15,
    updated: "static sample snapshot",
    source: "sample",
    sampleColumns: [
      "incident_id",
      "severity",
      "vector",
      "detection_minutes",
      "containment_hours",
      "root_cause",
    ],
  },
  {
    id: "ev-charging-utilization",
    title: "EV Charging Network Utilization",
    description:
      "Sessions, utilization, uptime, peak hours and revenue for 14 charging sites across city tiers.",
    category: "Energy",
    seller: samplePayout("ev-charging-utilization"),
    priceNear: "0.1",
    rows: 14,
    updated: "static sample snapshot",
    source: "sample",
    sampleColumns: [
      "site_id",
      "city_tier",
      "chargers",
      "utilization_pct",
      "uptime_pct",
      "revenue_usd",
    ],
  },
];

const demoVaultsById = new Map(DEMO_VAULTS.map((vault) => [vault.id, vault]));

export function getDemoVault(vaultId: string): MarketplaceVault | undefined {
  return demoVaultsById.get(vaultId);
}

export function isDemoVaultId(vaultId: string): boolean {
  return demoVaultsById.has(vaultId);
}
