import { getAuthToken, verifyTeeRpcIntegrity } from "@magicblock-labs/ephemeral-rollups-sdk";
import type { SessionWalletInterface } from "@magicblock-labs/gum-react-sdk";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";

export type MagicBlockCluster = "devnet" | "mainnet-beta" | "testnet" | "localnet";

export interface PrivateAuthSigner {
  publicKey: PublicKey;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}

export interface PrivateAuthToken {
  token: string;
  expiresAt: number;
}

export interface PrivateRoomSessionConfig {
  publicKey: PublicKey | null;
  error: string | null;
}

const configuredCluster =
  (import.meta.env.VITE_SOLANA_CLUSTER as MagicBlockCluster | undefined) ?? "devnet";

export const MAGICBLOCK_SOLANA_CLUSTER: MagicBlockCluster = configuredCluster;
export const MAGICBLOCK_SOLANA_RPC_URL =
  import.meta.env.VITE_SOLANA_RPC_URL ??
  (configuredCluster === "localnet" ? "http://127.0.0.1:8899" : clusterApiUrl(configuredCluster));
export const MAGICBLOCK_PRIVATE_RPC_URL =
  import.meta.env.VITE_PRIVATE_RPC_URL ?? "https://tee.magicblock.app";
export const MAGICBLOCK_TEE_VALIDATOR = new PublicKey(
  import.meta.env.VITE_PER_VALIDATOR ?? "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA",
);
export const MAGICBLOCK_SESSION_TARGET_PROGRAM_ID =
  import.meta.env.VITE_SESSION_TARGET_PROGRAM_ID ?? "";
export const MAGICBLOCK_SESSION_TOP_UP_LAMPORTS = parsePositiveNumber(
  import.meta.env.VITE_SESSION_TOP_UP_LAMPORTS,
  10_000_000,
);
export const MAGICBLOCK_SESSION_VALIDITY_MINUTES = parsePositiveNumber(
  import.meta.env.VITE_SESSION_VALIDITY_MINUTES,
  60,
);

export const magicBlockIntegrationChecklist = [
  "Wire Session Keys for low-friction buyer actions",
  "Attest TEE RPC and request auth token before private reads",
  "Create a permission group per listing",
  "Store hidden deal terms and bids in Private Ephemeral Rollup state",
  "Use crank scheduling for bid deadlines and room transitions",
  "Generate private settlement transactions for USDC transfers",
];

export async function verifyPrivateRpc(rpcUrl = MAGICBLOCK_PRIVATE_RPC_URL): Promise<boolean> {
  return verifyTeeRpcIntegrity(rpcUrl);
}

export async function requestPrivateAuthToken(
  signer: PrivateAuthSigner,
  rpcUrl = MAGICBLOCK_PRIVATE_RPC_URL,
): Promise<PrivateAuthToken> {
  const { token, expiresAt } = await getAuthToken(rpcUrl, signer.publicKey, signer.signMessage);

  return { token, expiresAt };
}

export function createPrivateConnection(
  token: string,
  rpcUrl = MAGICBLOCK_PRIVATE_RPC_URL,
): Connection {
  return new Connection(`${rpcUrl}?token=${encodeURIComponent(token)}`, "confirmed");
}

export async function createSessionForProgram(
  sessionWallet: SessionWalletInterface,
  targetProgram: PublicKey,
): Promise<void> {
  await sessionWallet.createSession(
    targetProgram,
    MAGICBLOCK_SESSION_TOP_UP_LAMPORTS,
    MAGICBLOCK_SESSION_VALIDITY_MINUTES,
  );
}

export function resolveSessionTargetProgram(
  value = MAGICBLOCK_SESSION_TARGET_PROGRAM_ID,
): PrivateRoomSessionConfig {
  const normalized = value.trim();

  if (normalized.length === 0) {
    return {
      publicKey: null,
      error: "Set VITE_SESSION_TARGET_PROGRAM_ID to enable real Session Keys.",
    };
  }

  try {
    return {
      publicKey: new PublicKey(normalized),
      error: null,
    };
  } catch {
    return {
      publicKey: null,
      error: "VITE_SESSION_TARGET_PROGRAM_ID is not a valid Solana public key.",
    };
  }
}

export function composeSettlementReceipt(
  listingName: string,
  bidderName: string,
): string {
  return `Receipt queued for ${listingName}; winner ${bidderName} visible only inside the room until closeout.`;
}

export function shortenAddress(value: string | null | undefined): string {
  if (!value) {
    return "Not available";
  }

  if (value.length <= 10) {
    return value;
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function formatExpiry(expiresAt: number | null): string {
  if (expiresAt === null) {
    return "Not issued";
  }

  return new Date(expiresAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
