import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { AdminDataError, listActivity, listVaultsForAdmin } from "@/lib/activityLog";
import { getPlatformTreasury } from "@/lib/platformFees";

const PRIVATE_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const MIN_PASSWORD_LENGTH = 12;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

// Per-instance brute-force throttle on wrong passwords.
const failures = new Map<string, { count: number; since: number }>();

function clientKey(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function isLockedOut(key: string) {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.since > FAILURE_WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function noteFailure(key: string) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.since > FAILURE_WINDOW_MS) failures.set(key, { count: 1, since: Date.now() });
  else entry.count += 1;
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

function passwordMatches(supplied: string, expected: string) {
  return timingSafeEqual(digest(supplied), digest(expected));
}

export async function GET(request: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD?.trim() ?? "";
  if (expected.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Admin access is off. Set ADMIN_PASSWORD (at least ${MIN_PASSWORD_LENGTH} characters) on the server.` },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }

  const key = clientKey(request);
  if (isLockedOut(key)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: PRIVATE_HEADERS });
  }

  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!supplied || !passwordMatches(supplied, expected)) {
    noteFailure(key);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return NextResponse.json({ error: "Wrong password." }, { status: 401, headers: PRIVATE_HEADERS });
  }
  failures.delete(key);

  try {
    const [activity, vaults] = await Promise.all([
      listActivity().catch((error: unknown) => {
        // The log table may not exist yet; still show live vaults.
        if (error instanceof AdminDataError && (error.status === 404 || error.status === 400)) return null;
        throw error;
      }),
      listVaultsForAdmin(),
    ]);
    return NextResponse.json(
      { treasury: getPlatformTreasury(), activity: activity ?? [], logReady: activity !== null, vaults },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    console.error("[Admin] Activity read failed.", {
      stage: error instanceof AdminDataError ? error.stage : "unknown",
      status: error instanceof AdminDataError ? error.status : undefined,
    });
    return NextResponse.json({ error: "Couldn't load admin data from Supabase." }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
