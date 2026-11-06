"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Wallet, WalletSelector } from "@near-wallet-selector/core";
import {
  disconnectWallet,
  getWalletConnectionState,
  initializeWalletSelector,
  openWalletModal,
} from "@/lib/nearWallet";

export type WalletContextValue = {
  accountId: string | null;
  selector: WalletSelector | null;
  wallet: Wallet | null;
  isReady: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

export const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);

  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider.");
  }

  return context;
}

export default function WalletProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    async function setupWallet() {
      try {
        // Reuses the app-wide singleton from lib/nearWallet so the provider and
        // the existing page integration share one testnet Wallet Selector.
        const selectorInstance = await initializeWalletSelector();

        if (!selectorInstance) {
          if (!cancelled) {
            setError("Wallet Selector is only available in the browser.");
            setIsReady(true);
          }
          return;
        }

        if (cancelled) return;

        const update = () => {
          if (cancelled) return;
          const state = getWalletConnectionState(selectorInstance);
          setAccountId(state.connected ? state.accountId : null);

          if (!state.connected) {
            setWallet(null);
            return;
          }

          // Resolve the active wallet as soon as the account connects so the
          // next click can invoke signing without an async pre-fetch first.
          void selectorInstance.wallet().then((activeWallet) => {
            if (!cancelled) setWallet(activeWallet);
          }).catch(() => {
            if (!cancelled) setWallet(null);
          });
        };

        setSelector(selectorInstance);
        update();
        setIsReady(true);

        const signedInSubscription = selectorInstance.on("signedIn", update);
        const signedOutSubscription = selectorInstance.on("signedOut", update);
        const accountsChangedSubscription = selectorInstance.on(
          "accountsChanged",
          update,
        );

        cleanup = () => {
          signedInSubscription.remove();
          signedOutSubscription.remove();
          accountsChangedSubscription.remove();
        };
      } catch (setupError) {
        if (!cancelled) {
          setError(
            setupError instanceof Error
              ? setupError.message
              : "Wallet Selector could not be initialized.",
          );
          setIsReady(true);
        }
      }
    }

    void setupWallet();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const signIn = useCallback(async () => {
    setError(null);

    try {
      await openWalletModal();
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : "Could not open the wallet modal.",
      );
      throw signInError;
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);

    try {
      await disconnectWallet();
      setAccountId(null);
      setWallet(null);
    } catch (signOutError) {
      setError(
        signOutError instanceof Error
          ? signOutError.message
          : "Could not disconnect the wallet.",
      );
      throw signOutError;
    }
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      accountId,
      selector,
      wallet,
      isReady,
      error,
      signIn,
      signOut,
    }),
    [accountId, selector, wallet, isReady, error, signIn, signOut],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
