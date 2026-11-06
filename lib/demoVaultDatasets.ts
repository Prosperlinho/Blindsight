/**
 * Server-only sample datasets.
 *
 * This module must never be imported by a client component: keeping the rows
 * on the server preserves the product promise that a buyer receives an insight
 * without receiving the source records. Only `/api/query-tee` imports it.
 */

import { DEMO_VAULTS } from "@/lib/demoVaults";

const Q3_FINANCIAL = `quarter,segment,revenue_usd,prior_quarter_usd,yoy_growth_pct,net_revenue_retention_pct,gross_margin_pct,churn_pct,active_accounts,notes
2026-Q3,Enterprise,2280000,1890000,34,121,83,0.9,312,"Expansion led by regulated financial data buyers"
2026-Q3,Mid-market,1245000,1108000,29,114,79,1.6,486,"Seats grew faster than revenue per seat"
2026-Q3,Self-serve,675000,612000,41,96,74,3.8,52,"Paid conversion improved after usage limits"
2026-Q3,Total,4200000,3610000,34,118,81,2.1,850,"Blended gross margin after inference and settlement"
2026-Q2,Enterprise,1890000,1602000,31,117,82,1.1,286,"Two lighthouse logos signed in June"
2026-Q2,Mid-market,1108000,982000,26,111,78,1.8,441,"Annual prepay mix reached 44 percent"
2026-Q2,Self-serve,612000,548000,36,94,73,4.2,41,"Support cost per account down 12 percent"
2026-Q2,Total,3610000,3132000,31,114,79,2.3,768,"Inference cost per query down 9 percent"
2026-Q1,Enterprise,1602000,1348000,28,114,81,1.2,254,"Security review cleared three enterprise deals"
2026-Q1,Mid-market,982000,874000,22,108,77,2.0,402,"Churn concentrated in sub-10k contracts"
2026-Q1,Self-serve,548000,501000,33,92,72,4.6,37,"Price test raised ARPU by 6 percent"
2026-Q1,Total,3132000,2723000,27,111,78,2.4,693,"First quarter above 3 million in revenue"
2025-Q4,Enterprise,1348000,1109000,24,110,80,1.4,221,"Largest cohort: private credit funds"
2025-Q4,Mid-market,874000,791000,18,105,76,2.3,361,"Pipeline coverage at 3.1x"
2025-Q4,Self-serve,501000,469000,29,90,71,4.9,33,"Self-serve remains an acquisition channel"
2025-Q4,Total,2723000,2369000,23,108,77,2.6,615,"Gross margin held despite higher inference volume"`;

const MEDICAL_COHORT = `site_id,cohort,participants,median_followup_months,primary_endpoint_reduction_pct,adverse_event_rate_pct,il6_baseline_pg_ml,dropout_pct,notes
SITE-01,Responder,684,18,31.2,1.4,8.9,4.1,"Largest responder cohort; two protocol deviations"
SITE-02,Responder,512,18,28.7,1.6,9.4,5.0,"Elevated IL-6 at baseline correlated with response"
SITE-03,Responder,438,17,26.9,1.9,8.2,5.8,"Longitudinal samples missing for 11 patients"
SITE-04,Responder,401,18,29.4,1.2,9.1,3.7,"No severe adverse events reported"
SITE-05,Responder,356,19,27.8,2.1,8.6,6.2,"Stopped enrollment early after target met"
SITE-06,Non-responder,702,18,9.6,2.3,5.7,7.4,"IL-6 did not separate from control cohort"
SITE-07,Non-responder,655,18,8.9,2.0,5.9,6.8,"Higher baseline symptom burden"
SITE-08,Non-responder,611,17,10.4,2.4,5.4,8.1,"Two sites reported cold-chain exceptions"
SITE-09,Control,720,18,1.8,1.7,6.0,4.9,"Matched on age, sex, and comorbidity index"
SITE-10,Control,688,18,2.2,1.5,6.3,5.2,"No unblinding events recorded"
SITE-11,Control,654,19,1.5,1.8,5.8,4.4,"Follow-up complete for 96 percent of participants"
SITE-12,Control,629,18,2.0,1.6,6.1,5.6,"One site replaced its imaging vendor"
SITE-13,Biomarker-substudy,410,18,33.1,1.1,10.2,3.2,"Substudy enriched for elevated baseline IL-6"
SITE-14,Biomarker-substudy,520,18,24.6,1.8,7.8,6.0,"Six percent lack a final longitudinal sample"`;

const SECURITY_AUDIT = `finding_id,severity,contract,status,category,description,recommendation
AUD-001,Critical,VaultCore,Resolved,Reentrancy,"Withdrawal path re-entered before balance update","Checks-effects-interactions plus a per-account mutex"
AUD-002,Critical,StrategyRouter,Resolved,Access Control,"Strategist role could upgrade a live strategy","Upgrade path moved behind a 48-hour timelock"
AUD-003,High,VaultCore,Resolved,Accounting,"Share price rounded down twice in the same transaction","Round in favour of the vault and add invariant tests"
AUD-004,High,OracleAdapter,Open,Oracle Risk,"Single-source price feed with no deviation guard","Add a second feed and a circuit breaker above 2 percent"
AUD-005,High,FeeManager,Resolved,Access Control,"Fee recipient could be changed without a delay","Two-step ownership transfer with a 24-hour delay"
AUD-006,High,StrategyRouter,Resolved,External Call,"Unchecked return value from a strategy deposit","Require a successful return and an event on every deposit"
AUD-007,Medium,UpgradeProxy,Resolved,Upgradeability,"Implementation slot was not validated on upgrade","Validate the implementation and reinitialise explicitly"
AUD-008,Medium,VaultCore,Resolved,Denial of Service,"Unbounded depositor loop in a report function","Cap the batch size and move reporting off-chain"
AUD-009,Medium,OracleAdapter,Resolved,Stale Data,"Oracle heartbeat was not enforced","Reject prices older than the configured heartbeat"
AUD-010,Medium,FeeManager,Open,Operational,"Fee changes emit no off-chain alert","Emit an event and page the operations channel"
AUD-011,Low,StrategyRouter,Resolved,Input Validation,"Zero-address check missing for the treasury","Reject the zero address in the setter"
AUD-012,Low,UpgradeProxy,Resolved,Documentation,"Proxy admin key is a single EOA","Move the admin to a multisig before launch"
AUD-013,Low,VaultCore,Resolved,Event Coverage,"Deposit events omitted the caller","Include the caller and share amount in the event"
AUD-014,Informational,All,Resolved,Testing,"Branch coverage below target on upgrade paths","Raise branch coverage to at least 95 percent"
AUD-015,Informational,All,Open,Monitoring,"No on-chain invariant monitor for total assets","Deploy a read-only monitor with alerting"`;

const datasets: Record<string, string> = {
  "q3-financial-market-demand": Q3_FINANCIAL,
  "medical-research-cohort-2026": MEDICAL_COHORT,
  "solidity-security-audit-report": SECURITY_AUDIT,
};

export function getDemoVaultDataset(vaultId: string): string | undefined {
  return datasets[vaultId];
}

export function getDemoVaultRowCount(vaultId: string): number | undefined {
  const dataset = datasets[vaultId];
  if (!dataset) return undefined;
  const lines = dataset.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return Math.max(0, lines.length - 1);
}

export const DEMO_VAULT_IDS = DEMO_VAULTS.map((vault) => vault.id);
