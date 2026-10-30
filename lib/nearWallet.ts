import type { InjectedWallet, WalletSelector } from "@near-wallet-selector/core";
import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";

let selectorPromise: Promise<WalletSelector> | null = null;
let modalInstance: WalletSelectorModal | null = null;

export type NearWalletState = {
  connected: boolean;
  accountId: string | null;
};

export async function initializeWalletSelector(): Promise<WalletSelector | null> {
  if (typeof window === "undefined") {
    return null;
  }

  if (!selectorPromise) {
    selectorPromise = setupWalletSelector({
      network: "testnet",
      modules: [setupMyNearWallet(), setupMeteorWallet()],
      debug: false,
      optimizeWalletOrder: true,
      randomizeWalletOrder: false,
    });
  }

  const selector = await selectorPromise;

  if (!modalInstance) {
    modalInstance = setupModal(selector, {
      theme: "dark",
      description: "Connect your NEAR wallet to continue on BlindSight.",
    });
  }

  return selector;
}

export function getWalletConnectionState(selector: WalletSelector | null): NearWalletState {
  if (!selector) {
    return { connected: false, accountId: null };
  }

  const accounts = selector.store.getState().accounts ?? [];
  const accountId = accounts[0]?.accountId ?? null;

  return {
    connected: selector.isSignedIn() && Boolean(accountId),
    accountId,
  };
}

export async function openWalletModal() {
  const selector = await initializeWalletSelector();
  if (!selector || !modalInstance) {
    throw new Error("Wallet selector could not be initialized.");
  }

  modalInstance.show();
}

export async function createInstantWallet() {
  const selector = await initializeWalletSelector();
  if (!selector) {
    throw new Error("Wallet selector could not be initialized.");
  }

  const meteorWallet = await selector.wallet<InjectedWallet>("meteor-wallet");
  const accounts = await meteorWallet.signIn({});
  const accountId = accounts[0]?.accountId;

  if (!accountId) {
    throw new Error("Meteor Wallet did not return a connected account.");
  }

  return accountId;
}

export async function disconnectWallet() {
  const selector = await initializeWalletSelector();
  if (!selector || !selector.isSignedIn()) {
    return;
  }

  const wallet = await selector.wallet();

  if (typeof wallet.signOut === "function") {
    await wallet.signOut();
  }

  const activeWallet = wallet as { disconnect?: () => Promise<void> };
  if (typeof activeWallet.disconnect === "function") {
    await activeWallet.disconnect();
  }
}
