import { NextResponse } from "next/server";
import {
  createPublishedVault,
  listPublishedVaults,
  PublishedVaultStorageError,
} from "@/lib/publishedVaults";

export const maxDuration = 60;

const PRIVATE_HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const vaults = await listPublishedVaults();
    return NextResponse.json({ vaults }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error(
      "[Published Vaults] Listing failed:",
      error instanceof PublishedVaultStorageError
        ? { stage: error.stage, code: error.code, status: error.status }
        : error instanceof Error ? { name: error.name, message: error.message } : "unknown storage error",
    );
    return NextResponse.json(
      { error: "Published vaults are temporarily unavailable." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const value: unknown = await request.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return NextResponse.json({ error: "Invalid vault details." }, { status: 400 });
    }
    body = value as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid vault details." }, { status: 400 });
  }

  const { title, description, priceNear, publisherAddress, payoutAddress, dataset } = body;
  if ([title, description, priceNear, publisherAddress, payoutAddress, dataset].some((value) => typeof value !== "string")) {
    return NextResponse.json({ error: "Complete all required vault details." }, { status: 400 });
  }

  try {
    const vault = await createPublishedVault({
      title: title as string,
      description: description as string,
      priceNear: priceNear as string,
      publisherAddress: publisherAddress as string,
      payoutAddress: payoutAddress as string,
      dataset: dataset as string,
    });
    return NextResponse.json({ vault }, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to publish this vault.";
    const storageError = error instanceof PublishedVaultStorageError;
    console.error(
      "[Published Vaults] Publishing failed:",
      storageError
        ? { stage: error.stage, code: error.code, status: error.status }
        : error instanceof Error ? { name: error.name, message: error.message } : "unknown storage error",
    );
    const status = storageError ? 503 : 400;
    const userMessage = storageError
      ? process.env.NODE_ENV === "production"
        ? "Publishing is temporarily unavailable."
        : `Publishing is temporarily unavailable (${error.stage}: ${error.code}).`
      : message;
    return NextResponse.json(
      { error: userMessage },
      { status, headers: PRIVATE_HEADERS },
    );
  }
}