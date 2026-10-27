import type { ProcessWithdrawalArgs, WithdrawalParams } from "@defuse-protocol/intents-sdk";

const USDC_ASSET_ID = "nep141:usdc.omft.near";
const USDC_DECIMALS = 6;

export type DataPayoutResult = {
  transactionHash: string;
  status: "SETTLED";
};

function toUsdcBaseUnits(amountInUSDC: string | number) {
  const amount = String(amountInUSDC).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount)) {
    throw new Error("USDC amount must be a positive decimal with at most 6 places.");
  }

  const [whole, fraction = ""] = amount.split(".");
  const baseUnits = BigInt(whole) * BigInt(10) ** BigInt(USDC_DECIMALS) + BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
  if (baseUnits <= BigInt(0)) throw new Error("USDC amount must be greater than zero.");
  return baseUnits.toString();
}

export async function executeDataPayout(
  dataProviderAddress: string,
  amountInUSDC: string | number,
  attestationToken: string,
): Promise<DataPayoutResult> {
  if (!attestationToken.startsWith("mock_intel_tdx")) {
    throw new Error("TEE attestation token was not accepted.");
  }

  const recipient = dataProviderAddress.trim();
  if (!recipient || recipient.length > 128) {
    throw new Error("A valid data provider destination is required.");
  }

  const withdrawalParams = {
    assetId: USDC_ASSET_ID,
    amount: BigInt(toUsdcBaseUnits(amountInUSDC)),
    destinationAddress: recipient,
    feeInclusive: true,
  } satisfies WithdrawalParams;

  const sdkRequest = {
    withdrawalParams,
  } satisfies ProcessWithdrawalArgs<WithdrawalParams>;
  void sdkRequest;

  return {
    transactionHash: `mock-near-intent-${globalThis.crypto.randomUUID()}`,
    status: "SETTLED",
  };
}