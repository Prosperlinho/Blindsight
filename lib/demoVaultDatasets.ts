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

const DEFI_LENDING = `pool,asset,tvl_usd,utilization_pct,supply_apy_pct,borrow_apy_pct,max_ltv_pct,liquidations_30d,bad_debt_usd,oracle_source,notes
P-01,USDC,48200000,82.4,5.1,7.3,85,14,0,"Dual feed","Utilization above kink for 9 of 30 days"
P-02,USDT,31750000,78.9,4.6,6.8,85,9,0,"Dual feed","Stable demand from basis traders"
P-03,ETH,62400000,41.2,1.9,3.4,80,37,12400,"Single feed","Bad debt from one gap-down during a volatile weekend"
P-04,wBTC,27900000,33.5,0.8,2.1,73,11,0,"Dual feed","Low borrow demand; mostly used as collateral"
P-05,NEAR,18300000,56.7,3.2,5.9,70,52,8700,"Single feed","Highest liquidation count after a 22 percent drawdown"
P-06,stNEAR,9600000,24.8,0.7,2.6,65,6,0,"Dual feed","Liquid staking token; price derived from exchange rate"
P-07,DAI,14100000,71.3,4.0,5.8,85,4,0,"Dual feed","Supply cap reached twice this month"
P-08,ARB,6200000,48.1,2.7,5.4,60,29,3100,"Single feed","Thin on-chain liquidity raises liquidation slippage"
P-09,OP,5400000,44.6,2.4,5.1,60,21,1900,"Single feed","Governance unlock increased volatility"
P-10,LINK,7800000,38.9,1.6,3.9,68,13,0,"Dual feed","Stable collateral usage"
P-11,USDC.e,3900000,88.7,6.8,9.2,80,3,0,"Dual feed","Bridged stable; migration to native USDC ongoing"
P-12,AURORA,2100000,61.4,3.9,7.6,50,18,4600,"Single feed","Smallest pool; candidate for a lower LTV"
P-13,FRAX,4500000,66.2,3.6,5.4,75,2,0,"Dual feed","Peg held within 0.3 percent all month"
P-14,SOL,11200000,36.8,1.5,3.8,65,24,2200,"Single feed","Liquidations clustered in a two-hour window"`;

const VALIDATOR_PERFORMANCE = `node_id,region,stake_near,uptime_pct,blocks_produced,blocks_expected,chunks_missed,client_version,commission_pct,notes
VAL-01,EU-West,4820000,99.97,1442,1443,2,2.4.0,5,"Bare metal with a hot standby"
VAL-02,US-East,4310000,99.91,1288,1290,6,2.4.0,7,"Missed chunks during a planned migration"
VAL-03,AP-Southeast,3950000,99.42,1170,1181,41,2.3.1,5,"One version behind; disk latency spikes"
VAL-04,EU-Central,3620000,99.98,1084,1084,1,2.4.0,4,"Lowest miss rate in the set"
VAL-05,US-West,3180000,98.76,935,952,88,2.3.1,10,"Two restarts after out-of-memory events"
VAL-06,SA-East,2740000,99.85,817,819,9,2.4.0,6,"Single region; no failover"
VAL-07,EU-North,2510000,99.93,751,752,4,2.4.0,5,"Runs on renewable-powered hosting"
VAL-08,AP-Northeast,2290000,97.88,671,689,132,2.2.2,8,"Two versions behind; kicked out for one epoch"
VAL-09,US-Central,2050000,99.89,613,614,7,2.4.0,5,"Cloud VM with automated failover"
VAL-10,AF-South,1870000,99.71,557,560,15,2.4.0,9,"Network jitter on the upstream provider"
VAL-11,EU-West,1640000,99.95,491,491,3,2.4.0,3,"Lowest commission in the set"
VAL-12,ME-Central,1420000,99.37,421,425,29,2.3.1,7,"Clock drift alerts twice this epoch range"
VAL-13,AP-South,1210000,99.81,361,362,10,2.4.0,6,"Upgraded mid-period without downtime"
VAL-14,US-East,980000,98.94,289,293,47,2.3.1,12,"Highest commission; shared hardware"`;

const RETAIL_SALES = `month,region,category,revenue_usd,units_sold,avg_basket_usd,return_rate_pct,stockout_days,promo_share_pct,notes
2026-07,North,Electronics,1840000,6120,301,7.8,3,22,"Back-to-school laptop bundle"
2026-07,North,Grocery,2260000,148900,15,0.6,1,31,"Private label grew 4 points"
2026-07,South,Electronics,1310000,4560,287,9.4,6,28,"Stockouts on mid-range phones"
2026-07,South,Grocery,2780000,183400,15,0.5,0,26,"Heatwave lifted beverage sales"
2026-07,West,Apparel,960000,24800,39,14.2,2,35,"Returns driven by sizing issues"
2026-08,North,Electronics,2050000,6840,300,7.1,1,18,"Promo depth reduced with no volume loss"
2026-08,North,Grocery,2190000,144700,15,0.6,2,29,"Fresh produce supply delays"
2026-08,South,Electronics,1460000,5110,286,8.8,4,24,"Phone stock recovered mid-month"
2026-08,South,Grocery,2840000,187200,15,0.5,0,25,"Best grocery month of the year"
2026-08,West,Apparel,1120000,28300,40,12.9,1,30,"New size guide cut returns"
2026-09,North,Electronics,1720000,5800,297,7.4,0,15,"Post-season normalisation"
2026-09,North,Grocery,2210000,145900,15,0.6,1,27,"Stable baseline"
2026-09,South,Electronics,1390000,4890,284,8.1,2,21,"Accessories attach rate up 9 percent"
2026-09,South,Grocery,2650000,176100,15,0.5,1,24,"Weather normalised"
2026-09,West,Apparel,1240000,30900,40,11.6,0,27,"Autumn line launch"`;

const SAAS_ADOPTION = `feature,plan_tier,weekly_active_accounts,adoption_pct,median_sessions_per_week,day30_retention_pct,support_tickets_30d,nps,notes
Dashboards,Free,8420,61,3.1,38,212,21,"Entry point for most new accounts"
Dashboards,Pro,3150,88,5.4,71,96,44,"Core workflow for paid users"
Dashboards,Enterprise,640,94,7.9,86,31,52,"Embedded in weekly reviews"
Alerts,Free,2930,21,1.2,29,88,12,"Limited to three rules on free tier"
Alerts,Pro,2240,63,2.8,68,74,39,"Most requested upgrade reason"
Alerts,Enterprise,560,82,4.6,84,22,48,"Routed to on-call tools"
API Access,Pro,1410,39,6.2,77,141,35,"Rate-limit tickets dominate support load"
API Access,Enterprise,590,86,11.4,91,47,57,"Highest retention of any feature"
SSO,Enterprise,610,89,0.4,88,63,41,"Setup tickets fall after the first week"
Data Export,Free,1270,9,0.6,24,35,8,"Mostly one-off exports before churn"
Data Export,Pro,980,27,1.1,62,29,33,"Scheduled exports drive retention"
AI Summaries,Pro,1890,53,3.7,73,118,46,"Launched this quarter; fastest adoption curve"
AI Summaries,Enterprise,420,61,4.9,85,26,50,"Blocked for some accounts by data policy"
Audit Log,Enterprise,350,51,0.9,87,12,38,"Used mainly during compliance reviews"`;

const SUPPLY_CHAIN = `lane,mode,shipments,on_time_pct,avg_delay_hours,damage_rate_pct,cost_per_kg_usd,co2_kg_per_ton_km,primary_delay_cause
Shanghai-Rotterdam,Ocean,412,71.4,58.2,0.42,0.31,0.012,"Port congestion"
Shanghai-Los Angeles,Ocean,388,76.8,41.5,0.38,0.29,0.011,"Rail handoff backlog"
Shenzhen-Hamburg,Ocean,296,69.9,63.7,0.47,0.33,0.012,"Canal routing detours"
Singapore-Felixstowe,Ocean,241,74.2,49.1,0.51,0.32,0.012,"Vessel bunching"
Hong Kong-Frankfurt,Air,1180,93.6,6.4,0.12,3.85,0.602,"Ground handling"
Shanghai-Chicago,Air,964,91.2,8.1,0.15,4.10,0.598,"Customs inspection"
Lagos-London,Air,312,84.7,14.3,0.29,4.55,0.611,"Documentation errors"
Mumbai-Dubai,Ocean,358,88.1,19.6,0.33,0.24,0.013,"Weather"
Dubai-Nairobi,Air,227,86.3,11.9,0.21,3.40,0.605,"Capacity rollovers"
Rotterdam-Warsaw,Road,1520,94.8,3.2,0.18,0.19,0.062,"Driver hours limits"
Hamburg-Milan,Rail,684,89.5,7.6,0.09,0.14,0.022,"Track maintenance"
Monterrey-Dallas,Road,1970,92.1,4.4,0.23,0.17,0.065,"Border wait times"
Santos-Valencia,Ocean,203,72.6,55.8,0.44,0.30,0.012,"Strikes at origin"
Busan-Vancouver,Ocean,267,79.4,37.2,0.36,0.28,0.011,"Rail capacity inland"`;

const SOC_INCIDENTS = `incident_id,month,severity,vector,affected_system,detection_minutes,containment_hours,status,root_cause
INC-101,2026-07,Critical,Credential stuffing,Customer portal,14,3.5,Closed,"No rate limit on the legacy login endpoint"
INC-102,2026-07,High,Phishing,Email,42,6.0,Closed,"Lookalike domain bypassed the mail filter"
INC-103,2026-07,Medium,Misconfiguration,Object storage,380,1.5,Closed,"Bucket policy allowed public listing"
INC-104,2026-07,Low,Malware,Endpoint,8,0.5,Closed,"Unsigned browser extension"
INC-105,2026-08,Critical,Supply chain,CI pipeline,96,11.0,Closed,"Compromised third-party build action"
INC-106,2026-08,High,Exposed secret,Code repository,22,2.0,Closed,"API key committed in a test fixture"
INC-107,2026-08,Medium,Phishing,Email,35,4.5,Closed,"MFA fatigue prompt accepted"
INC-108,2026-08,Medium,DDoS,Public API,3,1.0,Closed,"Unprotected origin address"
INC-109,2026-08,Low,Misconfiguration,DNS,620,0.8,Closed,"Dangling record to a deleted host"
INC-110,2026-09,High,Privilege escalation,Kubernetes,51,5.5,Closed,"Over-broad service account role"
INC-111,2026-09,High,Credential stuffing,Admin panel,18,2.5,Closed,"Admin panel reachable without VPN"
INC-112,2026-09,Medium,Exposed secret,Logging,240,3.0,Open,"Tokens written to debug logs"
INC-113,2026-09,Low,Malware,Endpoint,6,0.4,Closed,"Macro-enabled attachment"
INC-114,2026-09,Medium,Misconfiguration,Database,410,2.2,Open,"Snapshot shared outside the organisation"
INC-115,2026-09,Critical,Ransomware,File server,27,19.0,Closed,"Unpatched VPN appliance"`;

const EV_CHARGING = `site_id,city_tier,chargers,sessions_month,utilization_pct,avg_kwh_per_session,uptime_pct,peak_hour,revenue_usd,notes
EV-01,Tier 1,24,6820,38.4,31.2,98.9,18:00,98400,"Highway corridor; highest throughput"
EV-02,Tier 1,16,4410,34.7,28.6,97.6,08:00,58300,"Commuter peak in the morning"
EV-03,Tier 1,12,2980,29.1,26.4,99.3,19:00,36200,"Shopping centre; long dwell times"
EV-04,Tier 2,10,2140,24.6,33.8,95.2,17:00,33100,"Two chargers offline for ten days"
EV-05,Tier 2,8,1820,25.9,30.1,98.1,12:00,25400,"Fleet contract covers 40 percent of sessions"
EV-06,Tier 2,12,1960,18.7,27.9,96.4,18:00,25100,"Competitor opened nearby in August"
EV-07,Tier 3,6,780,14.3,35.6,93.8,13:00,12800,"Rural stop; long-range trips"
EV-08,Tier 1,20,5130,32.2,29.4,98.7,18:00,69000,"Dynamic pricing pilot site"
EV-09,Tier 3,4,410,11.6,38.2,91.5,15:00,7300,"Frequent comms outages"
EV-10,Tier 2,8,1540,22.8,31.7,99.0,09:00,22400,"Workplace charging; weekday heavy"
EV-11,Tier 1,14,3770,33.6,27.1,98.4,20:00,46800,"Residential area; evening peak"
EV-12,Tier 3,6,690,13.9,36.4,94.6,11:00,11600,"Tourist route; seasonal"
EV-13,Tier 2,10,2380,27.4,30.8,97.9,17:00,33800,"Solar canopy offsets 18 percent of load"
EV-14,Tier 1,18,4960,35.1,30.3,96.8,18:00,68700,"Grid capacity limits fast charging at peak"`;

const datasets: Record<string, string> = {
  "q3-financial-market-demand": Q3_FINANCIAL,
  "medical-research-cohort-2026": MEDICAL_COHORT,
  "solidity-security-audit-report": SECURITY_AUDIT,
  "defi-lending-pool-risk": DEFI_LENDING,
  "validator-node-performance": VALIDATOR_PERFORMANCE,
  "regional-retail-sales": RETAIL_SALES,
  "saas-feature-adoption": SAAS_ADOPTION,
  "supply-chain-lane-performance": SUPPLY_CHAIN,
  "soc-incident-summary": SOC_INCIDENTS,
  "ev-charging-utilization": EV_CHARGING,
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
