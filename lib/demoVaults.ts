/**
 * Sample vault catalog shared by the marketplace UI and the query API.
 *
 * This file contains metadata only. The actual sample datasets live in
 * `lib/demoVaultDatasets.ts`, which is imported exclusively by server code, so
 * the "private" sample rows are never shipped to the browser bundle.
 *
 * The sample catalog is deliberately small and labelled as a sample. Query
 * fees always settle to the real BlindSight testnet treasury; no publisher
 * payout is executed for these fictional listings.
 */

import { DEFAULT_TREASURY_ACCOUNT } from "@/lib/paymentConfig";

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
    seller: DEFAULT_TREASURY_ACCOUNT,
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
    seller: DEFAULT_TREASURY_ACCOUNT,
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
    seller: DEFAULT_TREASURY_ACCOUNT,
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
];

const demoVaultsById = new Map(DEMO_VAULTS.map((vault) => [vault.id, vault]));

export function getDemoVault(vaultId: string): MarketplaceVault | undefined {
  return demoVaultsById.get(vaultId);
}

export function isDemoVaultId(vaultId: string): boolean {
  return demoVaultsById.has(vaultId);
}
