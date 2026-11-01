"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type ExportKeyModalProps = {
  open: boolean;
  accountId: string;
  onClose: () => void;
  getPrivateKey: () => string | null;
  onError: (message: string) => void;
};

type VerificationState = "idle" | "verifying" | "pin" | "revealed" | "expired";

const AUTO_HIDE_MS = 30_000;
const PASSKEY_TIMEOUT_MS = 20_000;
const PIN_STORAGE_PREFIX = "blindsight_export_pin_v1";
const PASSKEY_STORAGE_PREFIX = "blindsight_export_passkey_v1";

function accountStorageKey(prefix: string, accountId: string): string {
  return `${prefix}:${accountId.trim().toLowerCase() || "unknown"}`;
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function hashPin(accountId: string, pin: string): Promise<string> {
  const payload = new TextEncoder().encode(`blindsight:${accountId.trim().toLowerCase()}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isWebAuthnAvailable(): boolean {
  return typeof window !== "undefined"
    && typeof window.PublicKeyCredential !== "undefined"
    && typeof navigator.credentials?.create === "function"
    && typeof navigator.credentials?.get === "function";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Passkey verification timed out.")), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function verifyPasskey(accountId: string): Promise<boolean> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const storageKey = accountStorageKey(PASSKEY_STORAGE_PREFIX, accountId);
  const storedCredentialId = window.localStorage.getItem(storageKey);

  if (!storedCredentialId) {
    const credential = await withTimeout(
      navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "BlindSight" },
          user: {
            id: new TextEncoder().encode(`blindsight:${accountId}`),
            name: accountId,
            displayName: `BlindSight ${accountId}`,
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: {
            userVerification: "required",
            residentKey: "preferred",
          },
          timeout: PASSKEY_TIMEOUT_MS,
          attestation: "none",
        },
      }),
      PASSKEY_TIMEOUT_MS,
    ) as PublicKeyCredential | null;

    if (!credential) return false;
    window.localStorage.setItem(storageKey, toBase64Url(credential.rawId));
    return true;
  }

  const assertion = await withTimeout(
    navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: "public-key", id: fromBase64Url(storedCredentialId) }],
        userVerification: "required",
        timeout: PASSKEY_TIMEOUT_MS,
      },
    }),
    PASSKEY_TIMEOUT_MS,
  );

  return Boolean(assertion);
}

export default function ExportKeyModal({
  open,
  accountId,
  onClose,
  getPrivateKey,
  onError,
}: ExportKeyModalProps) {
  const [state, setState] = useState<VerificationState>("idle");
  const [error, setError] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [storedPinHash, setStoredPinHash] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(Math.ceil(AUTO_HIDE_MS / 1000));
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    if (state !== "revealed") return;
    const hideAt = Date.now() + AUTO_HIDE_MS;
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((hideAt - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining <= 0) {
        window.clearInterval(interval);
        setRevealedKey(null);
        setState("expired");
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [state]);

  function revealKey() {
    const privateKey = getPrivateKey();
    if (!privateKey) {
      setError("No embedded wallet key was found in this browser.");
      setState("idle");
      return;
    }
    setRevealedKey(privateKey);
    setState("revealed");
    setSecondsRemaining(Math.ceil(AUTO_HIDE_MS / 1000));
    setCopied(false);
    setPin("");
    setConfirmPin("");
  }

  function enterPinFallback(message: string) {
    setStoredPinHash(window.localStorage.getItem(accountStorageKey(PIN_STORAGE_PREFIX, accountId)));
    setPin("");
    setConfirmPin("");
    setError(message);
    setState("pin");
  }

  async function handlePasskeyVerify() {
    setError("");
    if (!isWebAuthnAvailable()) {
      enterPinFallback("Passkey authentication is not available on this device. Enter an export PIN to continue.");
      return;
    }

    setState("verifying");
    try {
      const verified = await verifyPasskey(accountId);
      if (verified) {
        revealKey();
        return;
      }
      enterPinFallback("Passkey verification was not completed. Enter an export PIN to continue.");
    } catch (verificationError) {
      const dismissed = verificationError instanceof Error && verificationError.name === "NotAllowedError";
      enterPinFallback(
        dismissed
          ? "Passkey prompt was dismissed. Enter an export PIN to continue."
          : "Passkey verification failed. Enter an export PIN to continue.",
      );
    }
  }

  async function handlePinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!/^\d{6}$/.test(pin)) {
      setError("Enter a 6-digit PIN.");
      return;
    }

    try {
      if (!storedPinHash) {
        if (pin !== confirmPin) {
          setError("PINs do not match. Try again.");
          return;
        }
        const hash = await hashPin(accountId, pin);
        window.localStorage.setItem(accountStorageKey(PIN_STORAGE_PREFIX, accountId), hash);
        setStoredPinHash(hash);
        revealKey();
        return;
      }

      const hash = await hashPin(accountId, pin);
      if (hash !== storedPinHash) {
        setError("Incorrect PIN. Try again.");
        setPin("");
        return;
      }
      revealKey();
    } catch {
      setError("PIN verification is unavailable in this browser.");
    }
  }

  async function handleCopyKey() {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      setCopied(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 1800);
    } catch {
      onError("Could not copy the backup key.");
    }
  }

  function handleHideKey() {
    setRevealedKey(null);
    setState("expired");
  }

  function handleClose() {
    setRevealedKey(null);
    setPin("");
    setConfirmPin("");
    setError("");
    setState("idle");
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-key-title"
        className="relative w-full max-w-[520px] border border-emerald-500/20 bg-[#0B0F17]/95 p-5 shadow-[0_24px_100px_rgba(0,0,0,0.65)] sm:p-7"
      >
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close export key dialog"
          className="absolute right-4 top-4 grid size-8 place-items-center border border-emerald-500/20 text-[#A7B9B0] transition hover:border-[#34D399] hover:text-[#F0FDF4]"
        >
          ×
        </button>
        <h2 id="export-key-title" className="pr-10 font-serif text-xl font-medium text-[#F0FDF4]">
          Export Backup Key
        </h2>
        <p className="mt-2 text-xs leading-5 text-[#A7B9B0]">
          Import this key in another browser to access the same implicit account.
        </p>

        <div className="mt-4 border border-[#F59E0B]/60 bg-[#241C0E] p-3 text-xs leading-5 text-[#FDE68A]">
          Anyone with this private key can control your wallet. Store it securely and never share it.
        </div>

        {state === "idle" && (
          <div className="mt-5">
            <p className="text-[11px] leading-5 text-[#A7B9B0]">
              Confirm your identity with a passkey before the key is revealed. If passkeys are unavailable
              on this device, a local export PIN is used instead.
            </p>
            <button
              type="button"
              onClick={() => void handlePasskeyVerify()}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 bg-emerald-500 text-[12px] font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
            >
              Verify with Passkey
            </button>
          </div>
        )}

        {state === "verifying" && (
          <div role="status" className="mt-5 flex items-center gap-3 border border-emerald-500/25 bg-emerald-950/30 px-3 py-3 text-[11px] text-[#D1FAE5]">
            <span className="size-2 animate-pulse rounded-full bg-[#34D399]" />
            Verifying Passkey Biometrics...
          </div>
        )}

        {state === "pin" && (
          <form onSubmit={handlePinSubmit} className="mt-5 space-y-3">
            <p className="text-[10px] leading-4 text-[#7D9187]">
              {storedPinHash
                ? "Enter the 6-digit export PIN set for this wallet."
                : "No passkey is available. Create a 6-digit export PIN for this wallet. The PIN is stored as a hash in this browser."}
            </p>
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-[#A7B9B0]">
                {storedPinHash ? "Export PIN" : "Create export PIN"}
              </span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={pin}
                onChange={(event) => {
                  setPin(event.target.value.replace(/\D/g, "").slice(0, 6));
                  setError("");
                }}
                placeholder="••••••"
                className="h-10 w-full border border-emerald-500/20 bg-[#0B0F17]/80 px-3 font-mono text-[13px] tracking-[0.35em] text-[#E2F8EC] outline-none transition placeholder:text-[#7D9187] focus:border-[#10B981]/60"
              />
            </label>
            {!storedPinHash && (
              <label className="block">
                <span className="mb-1.5 block text-[11px] text-[#A7B9B0]">Confirm PIN</span>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(event) => {
                    setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 6));
                    setError("");
                  }}
                  placeholder="••••••"
                  className="h-10 w-full border border-emerald-500/20 bg-[#0B0F17]/80 px-3 font-mono text-[13px] tracking-[0.35em] text-[#E2F8EC] outline-none transition placeholder:text-[#7D9187] focus:border-[#10B981]/60"
                />
              </label>
            )}
            {error && (
              <div role="alert" className="border border-[#FCA5A5]/25 bg-[#261719] px-3 py-2 text-[11px] text-[#FCA5A5]">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={pin.length !== 6 || (!storedPinHash && confirmPin.length !== 6)}
              className="flex h-11 w-full items-center justify-center gap-2 bg-emerald-500 text-[12px] font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-[#047857] disabled:text-[#A7B9B0]"
            >
              {storedPinHash ? "Verify PIN & Reveal" : "Create PIN & Reveal"}
            </button>
            <button
              type="button"
              onClick={() => void handlePasskeyVerify()}
              className="w-full border border-emerald-500/20 px-3 py-2 text-[10px] text-[#A7B9B0] transition hover:border-emerald-500/40 hover:text-[#F0FDF4]"
            >
              Try passkey again
            </button>
          </form>
        )}

        {state === "revealed" && revealedKey && (
          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-[0.14em] text-[#7D9187]">Private key</span>
              <span role="status" className="font-mono text-[10px] text-[#34D399]">
                Auto-hides in {secondsRemaining}s
              </span>
            </div>
            <textarea
              readOnly
              aria-label="Embedded wallet private key"
              value={revealedKey}
              onFocus={(event) => event.currentTarget.select()}
              className="mt-2 min-h-20 w-full resize-none border border-emerald-500/20 bg-[#0B0F17]/80 p-3 font-mono text-xs leading-5 text-[#E2F8EC] outline-none focus:border-[#10B981]/60"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span role="status" className="text-xs text-[#10B981]">
                {copied ? "Backup key copied." : ""}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleHideKey}
                  className="border border-emerald-500/20 px-3 py-2 text-[11px] text-[#A7B9B0] transition hover:border-emerald-500/40 hover:text-[#F0FDF4]"
                >
                  Hide now
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyKey()}
                  className="bg-emerald-500 px-4 py-2 text-[11px] font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-400"
                >
                  Copy key
                </button>
              </div>
            </div>
          </div>
        )}

        {state === "expired" && (
          <div className="mt-5">
            <div role="status" className="border border-emerald-500/25 bg-emerald-950/30 px-3 py-3 text-[11px] leading-5 text-[#D1FAE5]">
              Key hidden for security after 30 seconds.
            </div>
            <button
              type="button"
              onClick={() => {
                setError("");
                setState("idle");
              }}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 bg-emerald-500 text-[12px] font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
            >
              Verify again to reveal
            </button>
          </div>
        )}

        {error && state !== "pin" && (
          <div role="alert" className="mt-3 border border-[#FCA5A5]/25 bg-[#261719] px-3 py-2 text-[11px] text-[#FCA5A5]">
            {error}
          </div>
        )}
      </section>
    </div>
  );
}
