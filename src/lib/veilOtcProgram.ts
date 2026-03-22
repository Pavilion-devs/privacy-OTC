import { AnchorProvider, BN, Program, web3 } from "@coral-xyz/anchor";
import {
  DELEGATION_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  permissionPdaFromAccount,
  waitUntilPermissionActive,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import type { AnchorWallet, WalletContextState } from "@solana/wallet-adapter-react";
import type { Connection, PublicKey, Transaction } from "@solana/web3.js";
import veilOtcIdl from "../idl/veil_otc.json";
import {
  MAGICBLOCK_PRIVATE_RPC_URL,
  MAGICBLOCK_TEE_VALIDATOR,
  createPrivateConnection,
} from "./magicblock";
import type { BidRecord, ListingRecord } from "../types";

const { Keypair, SystemProgram } = web3;

const readonlyKeypair = Keypair.generate();
const readonlyWallet: AnchorWallet = {
  publicKey: readonlyKeypair.publicKey,
  signAllTransactions: async () => {
    throw new Error("Readonly wallet cannot sign transactions.");
  },
  signTransaction: async () => {
    throw new Error("Readonly wallet cannot sign transactions.");
  },
};

const rawIdl = veilOtcIdl as {
  address: string;
};

export const VEIL_OTC_PROGRAM_ID = new web3.PublicKey(
  import.meta.env.VITE_OTC_PROGRAM_ID ?? String(rawIdl.address),
);
const ENABLE_TX_TRACE = import.meta.env.DEV && import.meta.env.VITE_ENABLE_TX_TRACE === "true";

export interface CreateListingInput {
  allowlist: string[];
  askMaxUsd: number;
  askMinUsd: number;
  assetName: string;
  category: string;
  hiddenTerms: string;
  settlementAsset: string;
  summary: string;
  symbol: string;
}

export interface UpsertBidInput {
  allocationBps: number;
  note: string;
  priceUsd: number;
}

export interface WalletTransactionSender {
  publicKey: PublicKey | null;
  signTransaction: WalletContextState["signTransaction"];
  sendTransaction: WalletContextState["sendTransaction"];
}

interface RawListingShellAccount {
  allowlist: PublicKey[];
  askMaxUsd: BN;
  askMinUsd: BN;
  assetName: string;
  bump: number;
  category: string;
  createdAt: BN;
  privateDetails: PublicKey;
  seed: BN;
  seller: PublicKey;
  settlementAsset: string;
  settlementReceipt: string;
  status: unknown;
  summary: string;
  symbol: string;
  updatedAt: BN;
  winningBid: PublicKey | null;
}

interface RawListingPrivateAccount {
  createdAt: BN;
  hiddenTerms: string;
  listingShell: PublicKey;
  seller: PublicKey;
  updatedAt: BN;
}

interface RawBidShellAccount {
  bidder: PublicKey;
  bump: number;
  createdAt: BN;
  listingShell: PublicKey;
  privateDetails: PublicKey;
  status: unknown;
  updatedAt: BN;
}

interface RawBidPrivateAccount {
  allocationBps: number;
  bidShell: PublicKey;
  bidder: PublicKey;
  createdAt: BN;
  listingShell: PublicKey;
  note: string;
  priceUsd: BN;
  updatedAt: BN;
}

export async function fetchMarketplaceState(
  connection: Connection,
  wallet: AnchorWallet | null,
): Promise<{
  bidsByListingId: Record<string, BidRecord[]>;
  listings: ListingRecord[];
}> {
  const program = getVeilOtcProgram(connection, wallet) as any;
  const [listingAccounts, bidAccounts] = await Promise.all([
    program.account.listingShell.all(),
    program.account.bidShell.all(),
  ]);

  const bids = bidAccounts
    .map((entry: any) => mapBidShellAccount(entry.publicKey, entry.account as RawBidShellAccount))
    .sort((left: BidRecord, right: BidRecord) => right.updatedAt - left.updatedAt);
  const bidsByListingId = bids.reduce(
    (accumulator: Record<string, BidRecord[]>, bid: BidRecord) => {
      const existing = accumulator[bid.listingId] ?? [];
      accumulator[bid.listingId] = [...existing, bid];
      return accumulator;
    },
    {} as Record<string, BidRecord[]>,
  );

  const listings = listingAccounts
    .map((entry: any) =>
      mapListingShellAccount(entry.publicKey, entry.account as RawListingShellAccount),
    )
    .sort((left: ListingRecord, right: ListingRecord) => {
      const leftArchived = left.status === "archived" ? 1 : 0;
      const rightArchived = right.status === "archived" ? 1 : 0;
      if (leftArchived !== rightArchived) {
        return leftArchived - rightArchived;
      }

      return right.createdAt - left.createdAt;
    });

  return { bidsByListingId, listings };
}

export async function hydrateMarketplacePrivacy(
  authToken: string,
  walletAddress: string,
  listings: ListingRecord[],
  bidsByListingId: Record<string, BidRecord[]>,
): Promise<{
  bidsByListingId: Record<string, BidRecord[]>;
  listings: ListingRecord[];
}> {
  const privateConnection = createPrivateConnection(authToken);
  const program = getVeilOtcProgram(privateConnection, null) as any;
  const listingsById = new Map(listings.map((listing) => [listing.address, listing]));

  const privateListingResults = await Promise.all(
    listings.map(async (listing) => {
      const hasAccess = listing.seller === walletAddress || listing.allowlist.includes(walletAddress);
      if (!hasAccess) {
        return null;
      }

      try {
        const account = (await program.account.listingPrivate.fetch(
          new web3.PublicKey(listing.privateDetails),
        )) as RawListingPrivateAccount;

        return {
          address: listing.address,
          hiddenTerms: account.hiddenTerms,
        };
      } catch {
        return null;
      }
    }),
  );

  const listingPrivateMap = new Map(
    privateListingResults
      .filter((entry): entry is { address: string; hiddenTerms: string } => entry !== null)
      .map((entry) => [entry.address, entry.hiddenTerms]),
  );

  const nextListings = listings.map((listing) => {
    const hiddenTerms = listingPrivateMap.get(listing.address);
    if (hiddenTerms === undefined) {
      return listing;
    }

    return {
      ...listing,
      hiddenTerms,
      privateLoaded: true,
    };
  });

  const privateBidResults = await Promise.all(
    Object.values(bidsByListingId)
      .flat()
      .map(async (bid) => {
        const listing = listingsById.get(bid.listingId);
        const isSeller = listing?.seller === walletAddress;
        const isBidder = bid.bidder === walletAddress;

        if (!isSeller && !isBidder) {
          return null;
        }

        try {
          const account = (await program.account.bidPrivate.fetch(
            new web3.PublicKey(bid.privateDetails),
          )) as RawBidPrivateAccount;

          return {
            address: bid.address,
            allocationBps: account.allocationBps,
            note: account.note,
            priceUsd: account.priceUsd.toNumber(),
            updatedAt: account.updatedAt.toNumber(),
          };
        } catch {
          return null;
        }
      }),
  );

  const bidPrivateMap = new Map(
    privateBidResults
      .filter(
        (
          entry,
        ): entry is {
          address: string;
          allocationBps: number;
          note: string;
          priceUsd: number;
          updatedAt: number;
        } => entry !== null,
      )
      .map((entry) => [entry.address, entry]),
  );

  const nextBidsByListingId = Object.fromEntries(
    Object.entries(bidsByListingId).map(([listingId, bids]) => [
      listingId,
      bids.map((bid) => {
        const detail = bidPrivateMap.get(bid.address);
        if (!detail) {
          return bid;
        }

        return {
          ...bid,
          allocationBps: detail.allocationBps,
          note: detail.note,
          priceUsd: detail.priceUsd,
          privateLoaded: true,
          updatedAt: detail.updatedAt,
        };
      }),
    ]),
  );

  return {
    bidsByListingId: nextBidsByListingId,
    listings: nextListings,
  };
}

export async function createListingTransaction(
  connection: Connection,
  wallet: WalletTransactionSender,
  input: CreateListingInput,
  authToken: string,
): Promise<{ listingAddress: string; privateSyncSignature: string; signature: string }> {
  if (!wallet.publicKey) {
    throw new Error("Connect a wallet before creating a listing.");
  }

  const program = getVeilOtcProgram(connection, null) as any;
  const seed = new BN(Date.now());
  const [listingShell] = deriveListingPda(wallet.publicKey, seed);
  const [listingPrivate] = deriveListingPrivatePda(listingShell);
  const listingPrivateRuntime = deriveDelegationAccounts(listingPrivate, VEIL_OTC_PROGRAM_ID);
  const listingPrivatePermission = permissionPdaFromAccount(listingPrivate);
  const listingPrivatePermissionRuntime = deriveDelegationAccounts(
    listingPrivatePermission,
    PERMISSION_PROGRAM_ID,
  );
  const transaction = new web3.Transaction();

  transaction.add(
    await program.methods
      .createListing(seed, {
        allowlist: input.allowlist.map((entry) => new web3.PublicKey(entry)),
        askMaxUsd: new BN(input.askMaxUsd),
        askMinUsd: new BN(input.askMinUsd),
        assetName: input.assetName.trim(),
        category: input.category.trim(),
        settlementAsset: input.settlementAsset.trim(),
        summary: input.summary.trim(),
        symbol: input.symbol.trim(),
      })
      .accountsPartial({
        listingPrivate,
        listingPrivatePermission,
        listingShell,
        permissionProgram: PERMISSION_PROGRAM_ID,
        seller: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction(),
  );

  transaction.add(
    await program.methods
      .delegateListingPrivate()
      .accountsPartial({
        delegationProgram: DELEGATION_PROGRAM_ID,
        listingPrivatePermission,
        listingShell,
        permissionProgram: PERMISSION_PROGRAM_ID,
        privateDetails: listingPrivate,
        privateDetailsDelegateBuffer: listingPrivateRuntime.delegateBuffer,
        privateDetailsDelegationMetadata: listingPrivateRuntime.delegationMetadata,
        privateDetailsDelegationRecord: listingPrivateRuntime.delegationRecord,
        privatePermissionDelegateBuffer: listingPrivatePermissionRuntime.delegateBuffer,
        privatePermissionDelegationMetadata: listingPrivatePermissionRuntime.delegationMetadata,
        privatePermissionDelegationRecord: listingPrivatePermissionRuntime.delegationRecord,
        seller: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        validator: MAGICBLOCK_TEE_VALIDATOR,
        veilOtcProgram: VEIL_OTC_PROGRAM_ID,
      })
      .instruction(),
  );

  const signature = await signAndSendTransaction(connection, wallet, transaction);
  await withRpcRetry(() =>
    waitUntilPermissionActive(MAGICBLOCK_PRIVATE_RPC_URL, listingPrivate, 30_000),
  );

  const privateConnection = createPrivateConnection(authToken);
  const privateProgram = getVeilOtcProgram(privateConnection, null) as any;
  const privateTransaction = await privateProgram.methods
    .updateListingPrivate(input.hiddenTerms.trim())
    .accountsPartial({
      listingShell,
      privateDetails: listingPrivate,
      seller: wallet.publicKey,
    })
    .transaction();
  await tracePrivateTransaction({
    delegatedWritableAccounts: [listingPrivate],
    label: "listing-private-sync",
    namedAccounts: {
      listingShell,
      privateDetails: listingPrivate,
      seller: wallet.publicKey,
    },
    privateConnection,
    publicConnection: connection,
    transaction: privateTransaction,
    walletPublicKey: wallet.publicKey,
  });
  const privateSyncSignature = await signAndSendPrivateTransaction(
    privateConnection,
    wallet,
    privateTransaction,
  );

  return {
    listingAddress: listingShell.toBase58(),
    privateSyncSignature,
    signature,
  };
}

export async function upsertBidTransaction(
  connection: Connection,
  wallet: WalletTransactionSender,
  listing: ListingRecord,
  input: UpsertBidInput,
  authToken: string,
  existingBid: BidRecord | null,
): Promise<{ privateSyncSignature: string; signature: string | null }> {
  if (!wallet.publicKey) {
    throw new Error("Connect a wallet before placing a bid.");
  }

  const [bidShell] = deriveBidPda(new web3.PublicKey(listing.address), wallet.publicKey);
  let bidPrivate = existingBid ? new web3.PublicKey(existingBid.privateDetails) : null;
  let signature: string | null = null;

  if (existingBid === null) {
    const program = getVeilOtcProgram(connection, null);
    const [derivedBidPrivate] = deriveBidPrivatePda(bidShell);
    const bidPrivatePermission = permissionPdaFromAccount(derivedBidPrivate);
    const bidPrivateRuntime = deriveDelegationAccounts(derivedBidPrivate, VEIL_OTC_PROGRAM_ID);
    const bidPrivatePermissionRuntime = deriveDelegationAccounts(
      bidPrivatePermission,
      PERMISSION_PROGRAM_ID,
    );
    const transaction = new web3.Transaction();

    bidPrivate = derivedBidPrivate;

    transaction.add(
      await program.methods
        .createBid()
        .accountsPartial({
          bidPrivate,
          bidPrivatePermission,
          bidShell,
          bidder: wallet.publicKey,
          listingShell: new web3.PublicKey(listing.address),
          permissionProgram: PERMISSION_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );

    transaction.add(
      await program.methods
        .delegateBidPrivate()
        .accountsPartial({
          bidPrivatePermission,
          bidShell,
          bidder: wallet.publicKey,
          delegationProgram: DELEGATION_PROGRAM_ID,
          listingShell: new web3.PublicKey(listing.address),
          permissionProgram: PERMISSION_PROGRAM_ID,
          privateDetails: bidPrivate,
          privateDetailsDelegateBuffer: bidPrivateRuntime.delegateBuffer,
          privateDetailsDelegationMetadata: bidPrivateRuntime.delegationMetadata,
          privateDetailsDelegationRecord: bidPrivateRuntime.delegationRecord,
          privatePermissionDelegateBuffer: bidPrivatePermissionRuntime.delegateBuffer,
          privatePermissionDelegationMetadata: bidPrivatePermissionRuntime.delegationMetadata,
          privatePermissionDelegationRecord: bidPrivatePermissionRuntime.delegationRecord,
          systemProgram: SystemProgram.programId,
          validator: MAGICBLOCK_TEE_VALIDATOR,
          veilOtcProgram: VEIL_OTC_PROGRAM_ID,
        })
        .instruction(),
    );

    signature = await signAndSendTransaction(connection, wallet, transaction);
    await withRpcRetry(() =>
      waitUntilPermissionActive(MAGICBLOCK_PRIVATE_RPC_URL, derivedBidPrivate, 30_000),
    );
  }

  if (bidPrivate === null) {
    throw new Error("Unable to resolve the private bid account.");
  }

  const privateConnection = createPrivateConnection(authToken);
  const privateProgram = getVeilOtcProgram(privateConnection, null) as any;
  const privateTransaction = await privateProgram.methods
    .updateBidPrivate({
      allocationBps: input.allocationBps,
      note: input.note.trim(),
      priceUsd: new BN(input.priceUsd),
    })
    .accountsPartial({
      bidShell,
      bidder: wallet.publicKey,
      listingShell: new web3.PublicKey(listing.address),
      privateDetails: bidPrivate,
    })
    .transaction();
  await tracePrivateTransaction({
    delegatedWritableAccounts: [bidPrivate],
    label: "bid-private-sync",
    namedAccounts: {
      bidShell,
      bidder: wallet.publicKey,
      listingShell: new web3.PublicKey(listing.address),
      privateDetails: bidPrivate,
    },
    privateConnection,
    publicConnection: connection,
    transaction: privateTransaction,
    walletPublicKey: wallet.publicKey,
  });
  const privateSyncSignature = await signAndSendPrivateTransaction(
    privateConnection,
    wallet,
    privateTransaction,
  );

  return {
    privateSyncSignature,
    signature,
  };
}

export async function closeBiddingTransaction(
  connection: Connection,
  wallet: WalletTransactionSender,
  listingAddress: string,
): Promise<string> {
  if (!wallet.publicKey) {
    throw new Error("Connect a wallet before closing bidding.");
  }

  const program = getVeilOtcProgram(connection, null) as any;
  const transaction = await program.methods
    .closeBidding()
    .accountsPartial({
      listingShell: new web3.PublicKey(listingAddress),
      seller: wallet.publicKey,
    })
    .transaction();

  return signAndSendTransaction(connection, wallet, transaction);
}

export async function selectWinnerTransaction(
  connection: Connection,
  wallet: WalletTransactionSender,
  listingAddress: string,
  bidAddress: string,
): Promise<string> {
  if (!wallet.publicKey) {
    throw new Error("Connect a wallet before selecting a winner.");
  }

  const program = getVeilOtcProgram(connection, null) as any;
  const transaction = await program.methods
    .selectWinner()
    .accountsPartial({
      bidShell: new web3.PublicKey(bidAddress),
      listingShell: new web3.PublicKey(listingAddress),
      seller: wallet.publicKey,
    })
    .transaction();

  return signAndSendTransaction(connection, wallet, transaction);
}

export async function completeSettlementTransaction(
  connection: Connection,
  wallet: WalletTransactionSender,
  listingAddress: string,
  settlementReceipt: string,
): Promise<string> {
  if (!wallet.publicKey) {
    throw new Error("Connect a wallet before completing settlement.");
  }

  const program = getVeilOtcProgram(connection, null) as any;
  const transaction = await program.methods
    .completeSettlement(settlementReceipt.trim())
    .accountsPartial({
      listingShell: new web3.PublicKey(listingAddress),
      seller: wallet.publicKey,
    })
    .transaction();

  return signAndSendTransaction(connection, wallet, transaction);
}

export async function archiveListingTransaction(
  connection: Connection,
  wallet: WalletTransactionSender,
  listingAddress: string,
): Promise<string> {
  if (!wallet.publicKey) {
    throw new Error("Connect a wallet before archiving a listing.");
  }

  const program = getVeilOtcProgram(connection, null) as any;
  const transaction = await program.methods
    .archiveListing()
    .accountsPartial({
      listingShell: new web3.PublicKey(listingAddress),
      seller: wallet.publicKey,
    })
    .transaction();

  return signAndSendTransaction(connection, wallet, transaction);
}

export function deriveListingPda(seller: PublicKey, seed: BN): [PublicKey, number] {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("listing"), seller.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
    VEIL_OTC_PROGRAM_ID,
  );
}

export function deriveBidPda(listing: PublicKey, bidder: PublicKey): [PublicKey, number] {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("bid"), listing.toBuffer(), bidder.toBuffer()],
    VEIL_OTC_PROGRAM_ID,
  );
}

export function deriveListingPrivatePda(listing: PublicKey): [PublicKey, number] {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("listing-private"), listing.toBuffer()],
    VEIL_OTC_PROGRAM_ID,
  );
}

export function deriveBidPrivatePda(bid: PublicKey): [PublicKey, number] {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("bid-private"), bid.toBuffer()],
    VEIL_OTC_PROGRAM_ID,
  );
}

export function normalizeAllocationBps(value: number): string {
  if (value >= 10_000) {
    return "100% fill";
  }

  if (value <= 0) {
    return "Pending private sync";
  }

  return `${(value / 100).toFixed(2).replace(/\.00$/, "")}% fill`;
}

function deriveDelegationAccounts(permissionedAccount: PublicKey, ownerProgram: PublicKey) {
  return {
    delegateBuffer: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
      permissionedAccount,
      ownerProgram,
    ),
    delegationMetadata: delegationMetadataPdaFromDelegatedAccount(permissionedAccount),
    delegationRecord: delegationRecordPdaFromDelegatedAccount(permissionedAccount),
  };
}

async function signAndSendTransaction(
  connection: Connection,
  wallet: WalletTransactionSender,
  transaction: Transaction,
): Promise<string> {
  const signature = await withRpcRetry(() =>
    wallet.sendTransaction(transaction, connection, {
      preflightCommitment: "confirmed",
    }),
  );
  const latestBlockhash = await withRpcRetry(() => connection.getLatestBlockhash("confirmed"));
  await withRpcRetry(() =>
    connection.confirmTransaction(
      {
        ...latestBlockhash,
        signature,
      },
      "confirmed",
    ),
  );

  return signature;
}

async function signAndSendPrivateTransaction(
  connection: Connection,
  wallet: WalletTransactionSender,
  transaction: Transaction,
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error("Connected wallet must support signTransaction for private writes.");
  }

  const latestBlockhash = await withRpcRetry(() => connection.getLatestBlockhash("confirmed"));
  transaction.feePayer = wallet.publicKey;
  transaction.recentBlockhash = latestBlockhash.blockhash;

  try {
    const signedTransaction = await wallet.signTransaction(transaction);
    const signature = await withRpcRetry(() =>
      connection.sendRawTransaction(signedTransaction.serialize(), {
        preflightCommitment: "confirmed",
      }),
    );

    await withRpcRetry(() =>
      connection.confirmTransaction(
        {
          ...latestBlockhash,
          signature,
        },
        "confirmed",
      ),
    );

    return signature;
  } catch (error) {
    await logTransactionError("private-send", connection, transaction, error);
    throw error;
  }
}

async function withRpcRetry<T>(run: () => Promise<T>, attempts = 4, delayMs = 500): Promise<T> {
  let lastError: unknown;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const shouldRetry =
        message.includes("429") ||
        message.includes("Too many requests") ||
        message.includes("rate limit");

      if (!shouldRetry || index === attempts - 1) {
        throw error;
      }

      await new Promise((resolve) => window.setTimeout(resolve, delayMs * (index + 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("RPC request failed.");
}

async function tracePrivateTransaction({
  delegatedWritableAccounts,
  label,
  namedAccounts,
  privateConnection,
  publicConnection,
  transaction,
  walletPublicKey,
}: {
  delegatedWritableAccounts: PublicKey[];
  label: string;
  namedAccounts: Record<string, PublicKey>;
  privateConnection: Connection;
  publicConnection: Connection;
  transaction: Transaction;
  walletPublicKey: PublicKey;
}) {
  if (!ENABLE_TX_TRACE) {
    return;
  }

  const metas = summarizeTransaction(transaction);
  const writableAccounts = metas.filter((meta) => meta.isWritable);

  console.groupCollapsed(`[VeilOTC trace] ${label}`);
  console.info("public rpc", publicConnection.rpcEndpoint);
  console.info("private rpc", privateConnection.rpcEndpoint);
  console.info(
    "delegated writable accounts",
    delegatedWritableAccounts.map((entry) => entry.toBase58()),
  );
  console.info(
    "named accounts",
    Object.fromEntries(
      Object.entries(namedAccounts).map(([key, value]) => [key, value.toBase58()]),
    ),
  );
  console.table(metas);

  const suspiciousWritableAccounts = writableAccounts.filter(
    (meta) =>
      !delegatedWritableAccounts.some((entry) => entry.toBase58() === meta.pubkey) &&
      meta.pubkey !== walletPublicKey.toBase58(),
  );

  if (suspiciousWritableAccounts.length > 0) {
    console.warn(
      `[VeilOTC trace] ${label} has writable non-delegated accounts`,
      suspiciousWritableAccounts.map((entry) => entry.pubkey),
    );
  }

  const [publicSimulation, privateSimulation] = await Promise.all([
    simulateForTrace(publicConnection, transaction, walletPublicKey, "public"),
    simulateForTrace(privateConnection, transaction, walletPublicKey, "private"),
  ]);

  console.info("public simulation", publicSimulation);
  console.info("private simulation", privateSimulation);
  console.groupEnd();
}

async function simulateForTrace(
  connection: Connection,
  transaction: Transaction,
  feePayer: PublicKey,
  label: string,
): Promise<{
  endpoint: string;
  err: unknown;
  logs: string[] | null | undefined;
  ok: boolean;
  unitsConsumed: number | undefined;
}> {
  try {
    const simulation = await connection.simulateTransaction(cloneTransaction(transaction, feePayer));
    return {
      endpoint: `${label}:${connection.rpcEndpoint}`,
      err: simulation.value.err,
      logs: simulation.value.logs,
      ok: simulation.value.err == null,
      unitsConsumed: simulation.value.unitsConsumed,
    };
  } catch (error) {
    if (error instanceof web3.SendTransactionError) {
      return {
        endpoint: `${label}:${connection.rpcEndpoint}`,
        err: error.transactionError.message,
        logs: error.logs,
        ok: false,
        unitsConsumed: undefined,
      };
    }

    return {
      endpoint: `${label}:${connection.rpcEndpoint}`,
      err: error instanceof Error ? error.message : String(error),
      logs: undefined,
      ok: false,
      unitsConsumed: undefined,
    };
  }
}

async function logTransactionError(
  label: string,
  connection: Connection,
  transaction: Transaction,
  error: unknown,
) {
  if (!ENABLE_TX_TRACE) {
    return;
  }

  const metas = summarizeTransaction(transaction);
  const logs =
    error instanceof web3.SendTransactionError
      ? error.logs ?? (await error.getLogs(connection).catch(() => undefined))
      : undefined;

  console.group(`[VeilOTC error] ${label}`);
  console.error(error);
  console.info("rpc", connection.rpcEndpoint);
  console.table(metas);
  if (logs) {
    console.error("transaction logs", logs);
  }
  console.groupEnd();
}

function cloneTransaction(transaction: Transaction, feePayer: PublicKey): Transaction {
  const next = new web3.Transaction();
  next.feePayer = transaction.feePayer ?? feePayer;
  next.instructions = [...transaction.instructions];
  next.nonceInfo = transaction.nonceInfo;
  next.signatures = [...transaction.signatures];
  return next;
}

function summarizeTransaction(transaction: Transaction) {
  return transaction.instructions.flatMap((instruction, instructionIndex) =>
    instruction.keys.map((key, keyIndex) => ({
      instruction: instructionIndex,
      key: keyIndex,
      isSigner: key.isSigner,
      isWritable: key.isWritable,
      programId: instruction.programId.toBase58(),
      pubkey: key.pubkey.toBase58(),
    })),
  );
}

function getVeilOtcProgram(connection: Connection, wallet: AnchorWallet | null): Program<any> {
  const provider = new AnchorProvider(connection, wallet ?? readonlyWallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  return new Program(rawIdl as any, provider);
}

function mapListingShellAccount(publicKey: PublicKey, account: RawListingShellAccount): ListingRecord {
  return {
    address: publicKey.toBase58(),
    allowlist: account.allowlist.map((entry) => entry.toBase58()),
    askMaxUsd: account.askMaxUsd.toNumber(),
    askMinUsd: account.askMinUsd.toNumber(),
    assetName: account.assetName,
    category: account.category,
    createdAt: account.createdAt.toNumber(),
    hiddenTerms: "",
    privateDetails: account.privateDetails.toBase58(),
    privateLoaded: false,
    seed: account.seed.toString(),
    seller: account.seller.toBase58(),
    settlementAsset: account.settlementAsset,
    settlementReceipt: account.settlementReceipt,
    status: normalizeListingStatus(account.status),
    summary: account.summary,
    symbol: account.symbol,
    updatedAt: account.updatedAt.toNumber(),
    winningBid: account.winningBid?.toBase58() ?? null,
  };
}

function mapBidShellAccount(publicKey: PublicKey, account: RawBidShellAccount): BidRecord {
  return {
    address: publicKey.toBase58(),
    allocationBps: 0,
    bidder: account.bidder.toBase58(),
    createdAt: account.createdAt.toNumber(),
    listingId: account.listingShell.toBase58(),
    note: "",
    priceUsd: 0,
    privateDetails: account.privateDetails.toBase58(),
    privateLoaded: false,
    status: normalizeBidStatus(account.status),
    updatedAt: account.updatedAt.toNumber(),
  };
}

function normalizeListingStatus(value: unknown): ListingRecord["status"] {
  if (typeof value === "string") {
    return value as ListingRecord["status"];
  }

  const variant = Object.keys((value ?? {}) as Record<string, unknown>)[0];
  if (
    variant === "review" ||
    variant === "settling" ||
    variant === "closed" ||
    variant === "archived"
  ) {
    return variant;
  }

  return "bidding";
}

function normalizeBidStatus(value: unknown): BidRecord["status"] {
  if (typeof value === "string") {
    return value as BidRecord["status"];
  }

  const variant = Object.keys((value ?? {}) as Record<string, unknown>)[0];
  if (variant === "selected") {
    return "selected";
  }

  return "sealed";
}
