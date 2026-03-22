import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletRuntimePanel } from "./components/WalletRuntimePanel";
import { magicBlockIntegrationChecklist, shortenAddress } from "./lib/magicblock";
import {
  VEIL_OTC_PROGRAM_ID,
  archiveListingTransaction,
  closeBiddingTransaction,
  completeSettlementTransaction,
  createListingTransaction,
  fetchMarketplaceState,
  hydrateMarketplacePrivacy,
  normalizeAllocationBps,
  selectWinnerTransaction,
  upsertBidTransaction,
} from "./lib/veilOtcProgram";
import { useMagicBlockRuntime } from "./providers/MagicBlockRuntimeProvider";
import type { BidRecord, ListingRecord, ListingStatus, Milestone } from "./types";

type Page = "landing" | "dashboard";
type Tab = "rooms" | "orderbook" | "settlement" | "runtime";
type BusyAction =
  | "archiveListing"
  | "createListing"
  | "closeBidding"
  | "completeSettlement"
  | "placeBid"
  | "refresh"
  | "selectWinner"
  | null;
type NoticeTone = "info" | "success" | "warning" | "error";

interface AppNotice {
  tone: NoticeTone;
  message: string;
}

interface ListingFormState {
  allowlistInput: string;
  askMaxUsd: string;
  askMinUsd: string;
  assetName: string;
  category: string;
  hiddenTerms: string;
  settlementAsset: string;
  summary: string;
  symbol: string;
}

interface BidFormState {
  allocationBps: string;
  note: string;
  priceUsd: string;
}

const initialListingForm: ListingFormState = {
  allowlistInput: "",
  askMaxUsd: "230000",
  askMinUsd: "180000",
  assetName: "",
  category: "Vested token sale",
  hiddenTerms: "",
  settlementAsset: "USDC",
  summary: "",
  symbol: "",
};

const initialBidForm: BidFormState = {
  allocationBps: "10000",
  note: "",
  priceUsd: "",
};

function App() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();
  const runtime = useMagicBlockRuntime();
  const [page, setPage] = useState<Page>("landing");
  const [activeTab, setActiveTab] = useState<Tab>("rooms");
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [notice, setNotice] = useState<AppNotice>({
    tone: "info",
    message:
      "This dashboard now reads real Ola shells from chain and hydrates private terms and bid economics through MagicBlock.",
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [listingForm, setListingForm] = useState<ListingFormState>(initialListingForm);
  const [bidForm, setBidForm] = useState<BidFormState>(initialBidForm);
  const [settlementReceipt, setSettlementReceipt] = useState("");
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [bidsByListingId, setBidsByListingId] = useState<Record<string, BidRecord[]>>({});
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [showArchivedListings, setShowArchivedListings] = useState(false);

  const walletAddress = wallet.publicKey?.toBase58() ?? null;
  const walletKey = anchorWallet?.publicKey.toBase58() ?? "readonly";
  const visibleListings = useMemo(
    () =>
      showArchivedListings
        ? listings
        : listings.filter((listing) => listing.status !== "archived"),
    [listings, showArchivedListings],
  );
  const archivedListingsCount = listings.filter((listing) => listing.status === "archived").length;

  useEffect(() => {
    void refreshMarketplace(false);
  }, [walletKey, runtime.state.authToken, runtime.state.integrityVerified]);

  const selectedListing =
    visibleListings.find((listing) => listing.address === selectedListingId) ??
    visibleListings[0] ??
    null;
  const listingBids = useMemo(
    () =>
      selectedListing === null
        ? []
        : [...(bidsByListingId[selectedListing.address] ?? [])].sort(
            (left, right) => {
              const rightScore = right.privateLoaded ? right.priceUsd : -1;
              const leftScore = left.privateLoaded ? left.priceUsd : -1;
              if (rightScore !== leftScore) {
                return rightScore - leftScore;
              }

              return right.updatedAt - left.updatedAt;
            },
          ),
    [bidsByListingId, selectedListing],
  );
  const winningBid =
    selectedListing?.winningBid === null || selectedListing === null
      ? null
      : listingBids.find((bid) => bid.address === selectedListing.winningBid) ?? null;
  const isSeller =
    selectedListing !== null &&
    walletAddress !== null &&
    selectedListing.seller === walletAddress;
  const viewerHasPrivateAccess =
    selectedListing !== null &&
    walletAddress !== null &&
    (isSeller || selectedListing.allowlist.includes(walletAddress));
  const runtimeReady =
    runtime.walletConnected &&
    runtime.state.integrityVerified === true &&
    runtime.state.authToken !== null;
  const roomUnlocked = Boolean(selectedListing && viewerHasPrivateAccess && runtimeReady);
  const bidderExistingBid =
    selectedListing === null || walletAddress === null
      ? null
      : listingBids.find((bid) => bid.bidder === walletAddress) ?? null;
  const bidderCanCompose =
    selectedListing !== null &&
    walletAddress !== null &&
    !isSeller &&
    viewerHasPrivateAccess &&
    roomUnlocked &&
    selectedListing.status === "bidding" &&
    busyAction === null;
  const sellerControlsEnabled = Boolean(
    selectedListing && isSeller && roomUnlocked && busyAction === null,
  );
  const timeline = buildMilestones(selectedListing, runtimeReady, runtime.state, listingBids.length);
  const accessSummary = getAccessSummary(selectedListing, walletAddress, roomUnlocked, runtimeReady);
  const listingClockLabel = getListingClockLabel(selectedListing, listingBids.length);
  const walletRoleLabel = getWalletRoleLabel(selectedListing, walletAddress);

  async function refreshMarketplace(announce: boolean, includeArchived = showArchivedListings) {
    setBusyAction((current) => (current === null ? "refresh" : current));
    setLoadError(null);

    try {
      const next = await fetchMarketplaceState(connection, anchorWallet ?? null);
      const withPrivacy =
        runtime.state.authToken !== null && walletAddress !== null
          ? await hydrateMarketplacePrivacy(
              runtime.state.authToken,
              walletAddress,
              next.listings,
              next.bidsByListingId,
            )
          : next;

      setListings(withPrivacy.listings);
      setBidsByListingId(withPrivacy.bidsByListingId);
      setSelectedListingId((current) => {
        const nextVisibleListings = includeArchived
          ? withPrivacy.listings
          : withPrivacy.listings.filter((listing) => listing.status !== "archived");

        if (current && nextVisibleListings.some((listing) => listing.address === current)) {
          return current;
        }

        return nextVisibleListings[0]?.address ?? null;
      });

      if (announce) {
        setNotice({
          tone: "success",
          message: `Synced ${withPrivacy.listings.length} onchain listing${
            withPrivacy.listings.length === 1 ? "" : "s"
          } from ${shortenAddress(VEIL_OTC_PROGRAM_ID.toBase58())}.`,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load the VeilOTC program state.";
      setLoadError(message);
      setNotice({
        tone: "error",
        message,
      });
    } finally {
      setBusyAction((current) => (current === "refresh" ? null : current));
    }
  }

  async function handleCreateListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!anchorWallet) {
      setNotice({
        tone: "warning",
        message: "Connect a wallet before creating a listing.",
      });
      return;
    }

    if (!runtimeReady || runtime.state.authToken === null) {
      setNotice({
        tone: "warning",
        message:
          "Create listing now requires the live MagicBlock runtime path. Verify the TEE RPC and issue a PER auth token first.",
      });
      return;
    }

    const askMinUsd = Number(listingForm.askMinUsd.replace(/[^\d.]/g, ""));
    const askMaxUsd = Number(listingForm.askMaxUsd.replace(/[^\d.]/g, ""));
    const allowlist = parseAllowlistInput(listingForm.allowlistInput);

    if (
      listingForm.assetName.trim() === "" ||
      listingForm.symbol.trim() === "" ||
      listingForm.summary.trim() === ""
    ) {
      setNotice({
        tone: "warning",
        message: "Asset name, symbol, and summary are required.",
      });
      return;
    }

    if (!Number.isFinite(askMinUsd) || !Number.isFinite(askMaxUsd) || askMinUsd <= 0 || askMaxUsd < askMinUsd) {
      setNotice({
        tone: "warning",
        message: "Enter a valid ask range before creating the listing.",
      });
      return;
    }

    setBusyAction("createListing");

    try {
      const result = await createListingTransaction(connection, wallet, {
        allowlist,
        askMaxUsd,
        askMinUsd,
        assetName: listingForm.assetName,
        category: listingForm.category,
        hiddenTerms: listingForm.hiddenTerms,
        settlementAsset: listingForm.settlementAsset,
        summary: listingForm.summary,
        symbol: listingForm.symbol,
      }, runtime.state.authToken);

      await refreshMarketplace(false);
      setSelectedListingId(result.listingAddress);
      setListingForm(initialListingForm);
      setActiveTab("rooms");
      setNotice({
        tone: "success",
        message: `Listing shell created onchain and private terms synced through PER. Tx ${shortenAddress(result.signature)} / ${shortenAddress(result.privateSyncSignature)}.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Listing creation failed.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handlePlaceBid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!anchorWallet || selectedListing === null) {
      setNotice({
        tone: "warning",
        message: "Connect a wallet and choose a listing before placing a bid.",
      });
      return;
    }

    if (!runtimeReady || runtime.state.authToken === null) {
      setNotice({
        tone: "warning",
        message:
          "Bid submission now depends on the private runtime path. Verify the TEE RPC and issue a PER auth token first.",
      });
      return;
    }

    const priceUsd = Number(bidForm.priceUsd.replace(/[^\d.]/g, ""));
    const allocationBps = Number(bidForm.allocationBps);

    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      setNotice({
        tone: "warning",
        message: "Enter a valid bid price before submitting.",
      });
      return;
    }

    if (!Number.isFinite(allocationBps) || allocationBps <= 0 || allocationBps > 10_000) {
      setNotice({
        tone: "warning",
        message: "Allocation must be between 1 and 10,000 basis points.",
      });
      return;
    }

    setBusyAction("placeBid");

    try {
      const result = await upsertBidTransaction(
        connection,
        wallet,
        selectedListing,
        {
          allocationBps,
          note: bidForm.note,
          priceUsd,
        },
        runtime.state.authToken,
        bidderExistingBid,
      );
      await refreshMarketplace(false);
      setBidForm((previous) => ({
        ...previous,
        note: "",
      }));
      setActiveTab("orderbook");
      setNotice({
        tone: "success",
        message:
          result.signature === null
            ? `Private bid updated through PER. Tx ${shortenAddress(result.privateSyncSignature)}.`
            : `Bid shell created onchain and private price synced through PER. Tx ${shortenAddress(result.signature)} / ${shortenAddress(result.privateSyncSignature)}.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Bid submission failed.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCloseBidding() {
    if (!anchorWallet || selectedListing === null) {
      return;
    }

    setBusyAction("closeBidding");

    try {
      const signature = await closeBiddingTransaction(connection, wallet, selectedListing.address);
      await refreshMarketplace(false);
      setNotice({
        tone: "success",
        message: `Listing moved into review. Tx ${shortenAddress(signature)}.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Failed to close bidding.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSelectWinner(bidAddress: string) {
    if (!anchorWallet || selectedListing === null) {
      return;
    }

    setBusyAction("selectWinner");

    try {
      const signature = await selectWinnerTransaction(
        connection,
        wallet,
        selectedListing.address,
        bidAddress,
      );
      await refreshMarketplace(false);
      setActiveTab("settlement");
      setNotice({
        tone: "success",
        message: `Winning bid selected onchain. Tx ${shortenAddress(signature)}.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Failed to select the winning bid.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCompleteSettlement() {
    if (!anchorWallet || selectedListing === null) {
      return;
    }

    const receipt =
      settlementReceipt.trim() === ""
        ? `Settlement closed for ${selectedListing.assetName}. Winning counterparty remains permissioned in the deal room.`
        : settlementReceipt.trim();

    setBusyAction("completeSettlement");

    try {
      const signature = await completeSettlementTransaction(
        connection,
        wallet,
        selectedListing.address,
        receipt,
      );
      await refreshMarketplace(false);
      setSettlementReceipt("");
      setNotice({
        tone: "success",
        message: `Settlement completed onchain. Tx ${shortenAddress(signature)}.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Failed to complete settlement.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleArchiveListing() {
    if (!anchorWallet || selectedListing === null) {
      return;
    }

    setBusyAction("archiveListing");

    try {
      const signature = await archiveListingTransaction(connection, wallet, selectedListing.address);
      setShowArchivedListings(false);
      await refreshMarketplace(false, false);
      setActiveTab("rooms");
      setNotice({
        tone: "success",
        message: `Listing archived from the active board. Tx ${shortenAddress(signature)}.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Failed to archive the listing.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  if (page === "landing") {
    return (
      <div className="landing">
        <div className="landing-orb" />
        <div className="landing-content">
          <span className="landing-eyebrow">MagicBlock Privacy Track</span>
          <h1 className="landing-title">Ola</h1>
          <p className="landing-tagline">
            A program-backed OTC marketplace on Solana for locked allocations,
            invite-only deal rooms, and seller-controlled winner selection,
            paired with MagicBlock runtime verification for private access flows.
          </p>
          <div className="landing-features">
            <div className="landing-feature">
              <strong>Real listings now live onchain</strong>
              <span>
                Listings and bid shells are no longer seeded demo state. The dashboard
                loads actual Ola program accounts.
              </span>
            </div>
            <div className="landing-feature">
              <strong>Private mirrors are delegated</strong>
              <span>
                Hidden terms and bid economics sync through delegated private accounts
                gated by wallet auth, TEE verification, and PER tokens.
              </span>
            </div>
          </div>
          <button className="landing-cta" onClick={() => setPage("dashboard")} type="button">
            Enter Marketplace
          </button>
          <span className="landing-footnote">
            Program ID {shortenAddress(VEIL_OTC_PROGRAM_ID.toBase58())}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <nav className="dash-nav">
        <div className="dash-nav-left">
          <span
            className="dash-brand"
            onClick={() => setPage("landing")}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => event.key === "Enter" && setPage("landing")}
          >
            Ola
          </span>
          <span className="dash-separator">·</span>
          <span className="dash-room-name">
            {selectedListing?.assetName ?? "No onchain listing selected"}
          </span>
        </div>
        <div className="dash-nav-right">
          <button
            className="secondary-button"
            disabled={busyAction !== null}
            onClick={() => void refreshMarketplace(true)}
            type="button"
          >
            {busyAction === "refresh" ? "Refreshing..." : "Refresh data"}
          </button>
          <span className="pill">
            {wallet.connected ? shortenAddress(walletAddress) : "Wallet disconnected"}
          </span>
          {selectedListing ? (
            <span className={`status ${selectedListing.status}`}>{selectedListing.status}</span>
          ) : null}
        </div>
      </nav>

      <div className="dash-context">
        <p className="dash-context-text">{accessSummary}</p>
        <div className="dash-context-meta">
          <span>{walletRoleLabel}</span>
          <span>{selectedListing ? formatAskRange(selectedListing) : "No ask range"}</span>
          <span>{listingClockLabel}</span>
          <span>{roomUnlocked ? "Room unlocked" : getRuntimeMetaLabel(runtime.state)}</span>
        </div>
      </div>

      <div className="tab-bar">
        {(
          [
            ["rooms", "Deal Rooms"],
            ["orderbook", "Order Book"],
            ["settlement", "Settlement"],
            ["runtime", "Wallet & Runtime"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={activeTab === key ? "tab active" : "tab"}
            onClick={() => setActiveTab(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        <div className={`runtime-notice ${notice.tone}`}>
          <strong>{getRuntimeNoticeTitle(notice.tone)}</strong>
          <p>{notice.message}</p>
        </div>

        {loadError ? <p className="runtime-error">{loadError}</p> : null}

        {activeTab === "rooms" && (
          <div className="tab-panel" key="rooms">
            <div className="room-controls-grid">
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <div className="section-label">Create listing</div>
                    <h3>Publish onchain room</h3>
                  </div>
                  <span className="micro-copy">Seller-signed PDA</span>
                </div>
                <p className="panel-copy">
                  New listings now create a public onchain shell plus a delegated private mirror
                  for hidden terms. Put one wallet per line or comma in the allowlist field.
                </p>
                <form className="composer" onSubmit={handleCreateListing}>
                  <div className="form-grid">
                    <label>
                      <span>Asset name</span>
                      <input
                        onChange={(event) =>
                          setListingForm((previous) => ({
                            ...previous,
                            assetName: event.target.value,
                          }))
                        }
                        placeholder="Helio Network Locked Allocation"
                        value={listingForm.assetName}
                      />
                    </label>
                    <label>
                      <span>Symbol</span>
                      <input
                        onChange={(event) =>
                          setListingForm((previous) => ({
                            ...previous,
                            symbol: event.target.value.toUpperCase(),
                          }))
                        }
                        placeholder="HELIO"
                        value={listingForm.symbol}
                      />
                    </label>
                    <label>
                      <span>Category</span>
                      <input
                        onChange={(event) =>
                          setListingForm((previous) => ({
                            ...previous,
                            category: event.target.value,
                          }))
                        }
                        placeholder="Vested token sale"
                        value={listingForm.category}
                      />
                    </label>
                    <label>
                      <span>Settlement asset</span>
                      <input
                        onChange={(event) =>
                          setListingForm((previous) => ({
                            ...previous,
                            settlementAsset: event.target.value.toUpperCase(),
                          }))
                        }
                        placeholder="USDC"
                        value={listingForm.settlementAsset}
                      />
                    </label>
                    <label>
                      <span>Ask min USD</span>
                      <input
                        inputMode="numeric"
                        onChange={(event) =>
                          setListingForm((previous) => ({
                            ...previous,
                            askMinUsd: event.target.value,
                          }))
                        }
                        placeholder="180000"
                        value={listingForm.askMinUsd}
                      />
                    </label>
                    <label>
                      <span>Ask max USD</span>
                      <input
                        inputMode="numeric"
                        onChange={(event) =>
                          setListingForm((previous) => ({
                            ...previous,
                            askMaxUsd: event.target.value,
                          }))
                        }
                        placeholder="230000"
                        value={listingForm.askMaxUsd}
                      />
                    </label>
                  </div>
                  <label>
                    <span>Summary</span>
                    <textarea
                      onChange={(event) =>
                        setListingForm((previous) => ({
                          ...previous,
                          summary: event.target.value,
                        }))
                      }
                      placeholder="Short public description for the deal room."
                      rows={3}
                      value={listingForm.summary}
                    />
                  </label>
                  <label>
                    <span>Hidden terms</span>
                    <textarea
                      onChange={(event) =>
                        setListingForm((previous) => ({
                          ...previous,
                          hiddenTerms: event.target.value,
                        }))
                      }
                      placeholder="Reserve price, unlock schedule, or private instructions."
                      rows={4}
                      value={listingForm.hiddenTerms}
                    />
                  </label>
                  <label>
                    <span>Allowlisted buyers</span>
                    <textarea
                      onChange={(event) =>
                        setListingForm((previous) => ({
                          ...previous,
                          allowlistInput: event.target.value,
                        }))
                      }
                      placeholder="Buyer wallet 1, Buyer wallet 2"
                      rows={3}
                      value={listingForm.allowlistInput}
                    />
                  </label>
                  <div className="composer-footer">
                    <p>
                      Seller wallet: {wallet.connected ? shortenAddress(walletAddress) : "Connect wallet"}
                    </p>
                    <button
                      className="primary-button"
                      disabled={!anchorWallet || busyAction !== null}
                      type="submit"
                    >
                      {busyAction === "createListing"
                        ? "Creating..."
                        : "Create public shell + private room"}
                    </button>
                  </div>
                </form>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <div className="section-label">Program state</div>
                    <h3>Current sync</h3>
                  </div>
                  <span className="micro-copy">{shortenAddress(VEIL_OTC_PROGRAM_ID.toBase58())}</span>
                </div>
                <dl className="settlement-grid">
                  <div>
                    <dt>Listings</dt>
                    <dd>{listings.length}</dd>
                  </div>
                  <div>
                    <dt>Bids</dt>
                    <dd>{Object.values(bidsByListingId).flat().length}</dd>
                  </div>
                  <div>
                    <dt>Connected wallet</dt>
                    <dd>{shortenAddress(walletAddress)}</dd>
                  </div>
                  <div>
                    <dt>Runtime</dt>
                    <dd>{roomUnlocked ? "Verified + authed" : getRuntimeMetaLabel(runtime.state)}</dd>
                  </div>
                </dl>
                <p className="panel-copy">
                  Public wrappers now come from the Ola program, while hidden terms and bid
                  economics sync through delegated private accounts on MagicBlock.
                </p>
              </section>
            </div>

            {visibleListings.length === 0 ? (
              <section className="panel">
                <div className="empty-state">
                  <strong>{listings.length === 0 ? "No onchain listings yet." : "No active listings in view."}</strong>
                  <p>
                    {listings.length === 0
                      ? "Create the first listing above, then refresh the dashboard."
                      : "All current rooms are archived. Toggle archived listings to inspect historical deal rooms."}
                  </p>
                  {archivedListingsCount > 0 ? (
                    <button
                      className="secondary-button"
                      onClick={() => setShowArchivedListings(true)}
                      type="button"
                    >
                      Show archived listings
                    </button>
                  ) : null}
                </div>
              </section>
            ) : (
              <>
                <div className="listings-toolbar">
                  <div>
                    <div className="section-label">Room board</div>
                    <h3>
                      {visibleListings.length}{" "}
                      {showArchivedListings ? "listing" : "active listing"}
                      {visibleListings.length === 1 ? "" : "s"}
                    </h3>
                  </div>
                  {archivedListingsCount > 0 || showArchivedListings ? (
                    <button
                      className="secondary-button"
                      onClick={() => setShowArchivedListings((current) => !current)}
                      type="button"
                    >
                      {showArchivedListings
                        ? "Hide archived"
                        : `Show archived (${archivedListingsCount})`}
                    </button>
                  ) : null}
                </div>

                <section className="listing-grid">
                  {visibleListings.map((listing) => (
                    <button
                      key={listing.address}
                      className={
                        listing.address === selectedListing?.address
                          ? "listing-card active"
                          : "listing-card"
                      }
                      onClick={() => setSelectedListingId(listing.address)}
                      type="button"
                    >
                      <div className="card-topline">
                        <span>{listing.category}</span>
                        <span className={`status ${listing.status}`}>{listing.status}</span>
                      </div>
                      <h3>{listing.assetName}</h3>
                      <p>{listing.summary}</p>
                      <dl className="meta-grid">
                        <div>
                          <dt>Seller</dt>
                          <dd>{shortenAddress(listing.seller)}</dd>
                        </div>
                        <div>
                          <dt>Ask range</dt>
                          <dd>{formatAskRange(listing)}</dd>
                        </div>
                        <div>
                          <dt>Settlement</dt>
                          <dd>{listing.settlementAsset}</dd>
                        </div>
                        <div>
                          <dt>Clock</dt>
                          <dd>{getListingClockLabel(listing, (bidsByListingId[listing.address] ?? []).length)}</dd>
                        </div>
                      </dl>
                    </button>
                  ))}
                </section>

                {selectedListing ? (
                  <>
                    <div className="room-detail">
                      <div className="room-detail-header">
                        <div>
                          <div className="section-label">Selected room</div>
                          <h3>{selectedListing.assetName}</h3>
                        </div>
                        <span className={`status ${selectedListing.status}`}>{selectedListing.status}</span>
                      </div>

                      <div className="room-gate">
                        <strong>
                          {getRoomGateTitle(selectedListing, walletAddress, roomUnlocked, runtimeReady)}
                        </strong>
                        <p>
                          {getRoomGateBody(selectedListing, walletAddress, roomUnlocked, runtimeReady)}
                        </p>
                      </div>

                      <div className="detail-grid">
                        <div className="detail-card">
                          <div className="section-label">Public wrapper</div>
                          <p>
                            {selectedListing.symbol} sale by {shortenAddress(selectedListing.seller)}.
                            Settlement in {selectedListing.settlementAsset}.
                          </p>
                          <p className="muted-copy">
                            The public wrapper is now onchain. Hidden room access still depends on
                            the connected wallet and runtime auth flow.
                          </p>
                        </div>
                        <div className="detail-card">
                          <div className="section-label">Private room terms</div>
                          {roomUnlocked && selectedListing.privateLoaded ? (
                            <ul className="text-list">
                              <li>{selectedListing.hiddenTerms || "No hidden terms provided."}</li>
                              <li>{selectedListing.allowlist.length} buyer wallet(s) allowlisted.</li>
                              <li>Hidden terms are now sourced from the delegated private mirror account.</li>
                            </ul>
                          ) : roomUnlocked ? (
                            <div className="placeholder-stack">
                              <span className="placeholder-chip">Private mirror is delegated but this wallet has not loaded hidden terms yet</span>
                              <span className="placeholder-chip">Refresh after auth if the room was just created</span>
                            </div>
                          ) : (
                            <div className="placeholder-stack">
                              <span className="placeholder-chip">Hidden terms gated behind runtime auth</span>
                              <span className="placeholder-chip">Allowlist still enforced by seller</span>
                              <span className="placeholder-chip">Settlement receipt redacted until closeout</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="timeline">
                        {timeline.map((milestone) => (
                          <div
                            key={milestone.id}
                            className={milestone.complete ? "timeline-item complete" : "timeline-item"}
                          >
                            <strong>{milestone.label}</strong>
                            <span>{milestone.detail}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="room-controls-grid">
                      <section className="panel">
                        <div className="panel-header">
                          <div>
                            <div className="section-label">Room access</div>
                            <h3>Live runtime gate</h3>
                          </div>
                          <span className={`status ${roomUnlocked ? "ready" : runtimeReady ? "review" : "bidding"}`}>
                            {roomUnlocked ? "room live" : runtimeReady ? "runtime ready" : "auth pending"}
                          </span>
                        </div>
                        <p className="panel-copy">
                          The room now uses a real public listing shell plus a private delegated
                          mirror account. Visibility still keys off the live MagicBlock runtime auth flow.
                        </p>
                        <dl className="settlement-grid compact runtime-grid">
                          <div>
                            <dt>Connected wallet</dt>
                            <dd>{shortenAddress(walletAddress)}</dd>
                          </div>
                          <div>
                            <dt>TEE check</dt>
                            <dd>
                              {formatRuntimeIntegrity(
                                runtime.state.integrityVerified,
                                runtime.state.integrityCheckedAt,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>PER auth token</dt>
                            <dd>
                              {runtime.state.authToken
                                ? shortenAddress(runtime.state.authToken)
                                : "Not issued"}
                            </dd>
                          </div>
                          <div>
                            <dt>Allowlist</dt>
                            <dd>{viewerHasPrivateAccess ? "Wallet allowed" : "Wallet blocked"}</dd>
                          </div>
                        </dl>

                        <div className={`runtime-notice ${runtime.state.notice?.tone ?? "info"}`}>
                          <strong>{getRuntimeNoticeTitle(runtime.state.notice?.tone ?? "info")}</strong>
                          <p>{runtime.state.notice?.message ?? "Runtime ready."}</p>
                        </div>

                        <div className="button-row">
                          <button
                            className="primary-button"
                            disabled={!runtime.walletConnected || runtime.state.busyAction !== null}
                            onClick={() => void runtime.actions.verifyPrivateRpc()}
                            type="button"
                          >
                            {runtime.state.busyAction === "verify" ? "Verifying..." : "Verify TEE RPC"}
                          </button>
                          <button
                            className="secondary-button"
                            disabled={
                              !runtime.walletConnected ||
                              !runtime.signMessageAvailable ||
                              runtime.state.busyAction !== null
                            }
                            onClick={() => void runtime.actions.issueAuthToken()}
                            type="button"
                          >
                            {runtime.state.busyAction === "auth"
                              ? "Authorizing..."
                              : "Issue PER auth token"}
                          </button>
                          <button
                            className="secondary-button"
                            onClick={() => setActiveTab("runtime")}
                            type="button"
                          >
                            Open runtime tab
                          </button>
                        </div>
                      </section>

                      <section className="panel">
                        <div className="panel-header">
                          <div>
                            <div className="section-label">Access control</div>
                            <h3>Allowlisted buyers</h3>
                          </div>
                        </div>
                        <WalletList
                          currentWallet={walletAddress}
                          entries={selectedListing.allowlist}
                          seller={selectedListing.seller}
                        />
                      </section>
                    </div>

                    <section className="panel">
                      <div className="panel-header">
                        <div>
                          <div className="section-label">Onchain facts</div>
                          <h3>Listing state</h3>
                        </div>
                      </div>
                      <dl className="settlement-grid">
                        <div>
                          <dt>Listing PDA</dt>
                          <dd>{selectedListing.address}</dd>
                        </div>
                        <div>
                          <dt>Private account</dt>
                          <dd>{selectedListing.privateDetails}</dd>
                        </div>
                        <div>
                          <dt>Seller</dt>
                          <dd>{selectedListing.seller}</dd>
                        </div>
                        <div>
                          <dt>Seed</dt>
                          <dd>{selectedListing.seed}</dd>
                        </div>
                        <div>
                          <dt>Created</dt>
                          <dd>{formatDateTime(selectedListing.createdAt)}</dd>
                        </div>
                        <div>
                          <dt>Updated</dt>
                          <dd>{formatDateTime(selectedListing.updatedAt)}</dd>
                        </div>
                        <div>
                          <dt>Winning bid</dt>
                          <dd>{selectedListing.winningBid ? shortenAddress(selectedListing.winningBid) : "Not selected"}</dd>
                        </div>
                      </dl>
                    </section>
                  </>
                ) : null}
              </>
            )}
          </div>
        )}

        {activeTab === "orderbook" && (
          <div className="tab-panel" key="orderbook">
            {selectedListing === null ? (
              <section className="panel">
                <div className="empty-state">
                  <strong>No listing selected.</strong>
                  <p>Create or select a listing first.</p>
                </div>
              </section>
            ) : (
              <section className="panel large">
                <div className="panel-header">
                  <div>
                    <div className="section-label">Bids · {selectedListing.assetName}</div>
                    <h3>Program-backed order flow</h3>
                  </div>
                  <span className="micro-copy">{getSellerActionLabel(selectedListing.status)}</span>
                </div>

                <div className="action-bar">
                  {isSeller && selectedListing.status === "bidding" ? (
                    <button
                      className="primary-button"
                      disabled={!sellerControlsEnabled}
                      onClick={() => void handleCloseBidding()}
                      type="button"
                    >
                      {busyAction === "closeBidding" ? "Closing..." : "Close bidding"}
                    </button>
                  ) : null}

                  {bidderExistingBid !== null ? (
                    <span className="inline-note">
                      {bidderExistingBid.privateLoaded
                        ? `Your private bid is loaded: ${formatCurrencyValue(
                            bidderExistingBid.priceUsd,
                          )} for ${normalizeAllocationBps(bidderExistingBid.allocationBps)}.`
                        : "Your bid shell exists. Private pricing loads after runtime auth."}
                    </span>
                  ) : null}
                </div>

                {!wallet.connected ? (
                  <div className="room-gate compact">
                    <strong>Connect a wallet.</strong>
                    <p>Read-only data can load, but creating or bidding requires a connected signer.</p>
                  </div>
                ) : !viewerHasPrivateAccess ? (
                  <div className="room-gate compact">
                    <strong>Bid wall locked.</strong>
                    <p>This wallet is not allowlisted for the selected room.</p>
                  </div>
                ) : !roomUnlocked ? (
                  <div className="room-gate compact">
                    <strong>Runtime not ready.</strong>
                    <p>Verify the TEE endpoint and issue a PER auth token before using the room flow.</p>
                  </div>
                ) : (
                  <>
                    <div className="bid-list">
                      {listingBids.length === 0 ? (
                        <div className="empty-state">
                          <strong>No bids yet.</strong>
                          <p>Allowlisted buyers can submit the first onchain bid once the room is unlocked.</p>
                        </div>
                      ) : (
                        listingBids.map((bid) => {
                          const reveal = shouldRevealBid(
                            bid,
                            selectedListing,
                            walletAddress,
                            isSeller,
                          );

                          return (
                            <div key={bid.address} className="bid-card">
                              <div>
                                <strong>{shortenAddress(bid.bidder)}</strong>
                                <span>{reveal ? formatDateTime(bid.updatedAt) : "Timestamp hidden"}</span>
                              </div>
                              <div className="bid-values">
                                <span>
                                  {reveal
                                    ? formatCurrencyValue(bid.priceUsd)
                                    : bid.privateLoaded
                                      ? "Private bid hidden from this wallet"
                                      : "Private bid not loaded"}
                                </span>
                                <small>
                                  {reveal
                                    ? normalizeAllocationBps(bid.allocationBps)
                                    : bid.privateLoaded
                                      ? "allocation redacted"
                                      : "pending private sync"}
                                </small>
                              </div>
                              <div className="bid-action-cell">
                                <span className={`status ${bid.status}`}>{bid.status}</span>
                                {isSeller && selectedListing.status === "review" ? (
                                  <button
                                    className="secondary-button"
                                    disabled={busyAction !== null || bid.status === "selected"}
                                    onClick={() => void handleSelectWinner(bid.address)}
                                    type="button"
                                  >
                                    {bid.status === "selected" ? "Winner" : "Select winner"}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {bidderCanCompose ? (
                      <form className="composer" onSubmit={handlePlaceBid}>
                        <div className="panel-header tight">
                          <div>
                            <div className="section-label">Bid composer</div>
                            <h3>Submit or revise onchain bid</h3>
                          </div>
                        </div>
                        <div className="form-grid">
                          <label>
                            <span>Price in USD</span>
                            <input
                              inputMode="numeric"
                              onChange={(event) =>
                                setBidForm((previous) => ({
                                  ...previous,
                                  priceUsd: event.target.value,
                                }))
                              }
                              placeholder="212000"
                              value={bidForm.priceUsd}
                            />
                          </label>
                          <label>
                            <span>Allocation</span>
                            <select
                              onChange={(event) =>
                                setBidForm((previous) => ({
                                  ...previous,
                                  allocationBps: event.target.value,
                                }))
                              }
                              value={bidForm.allocationBps}
                            >
                              <option value="10000">100% fill</option>
                              <option value="8000">80% fill</option>
                              <option value="5000">50% fill</option>
                              <option value="2500">25% fill</option>
                            </select>
                          </label>
                        </div>
                        <label>
                          <span>Bid note</span>
                          <textarea
                            onChange={(event) =>
                              setBidForm((previous) => ({
                                ...previous,
                                note: event.target.value,
                              }))
                            }
                            placeholder="Optional note stored in the delegated private bid account."
                            rows={3}
                            value={bidForm.note}
                          />
                        </label>
                        <div className="composer-footer">
                          <p>
                            Bid preview: {formatDraftPreview(bidForm.priceUsd)} for{" "}
                            {normalizeAllocationBps(Number(bidForm.allocationBps) || 0)}
                          </p>
                          <button
                            className="primary-button"
                            disabled={busyAction !== null || bidForm.priceUsd.trim() === ""}
                            type="submit"
                          >
                            {busyAction === "placeBid"
                              ? "Submitting..."
                              : bidderExistingBid
                                ? "Update private bid"
                                : "Create bid shell + private bid"}
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </>
                )}
              </section>
            )}
          </div>
        )}

        {activeTab === "settlement" && (
          <div className="tab-panel" key="settlement">
            {selectedListing === null ? (
              <section className="panel">
                <div className="empty-state">
                  <strong>No listing selected.</strong>
                  <p>Select a listing to inspect settlement state.</p>
                </div>
              </section>
            ) : (
              <div className="settlement-layout">
                <section className="panel large">
                  <div className="panel-header">
                    <div>
                      <div className="section-label">Settlement</div>
                      <h3>Program closeout</h3>
                    </div>
                    <span className={`status ${selectedListing.status}`}>{selectedListing.status}</span>
                  </div>
                  <dl className="settlement-grid">
                    <div>
                      <dt>Listing PDA</dt>
                      <dd>{selectedListing.address}</dd>
                    </div>
                    <div>
                      <dt>Winning bid</dt>
                      <dd>{winningBid ? shortenAddress(winningBid.address) : "Not selected"}</dd>
                    </div>
                    <div>
                      <dt>Winner wallet</dt>
                      <dd>{winningBid ? shortenAddress(winningBid.bidder) : "No winner yet"}</dd>
                    </div>
                    <div>
                      <dt>Receipt</dt>
                      <dd>{selectedListing.settlementReceipt || "No settlement receipt published yet."}</dd>
                    </div>
                  </dl>
                      {selectedListing.status === "settling" && isSeller && roomUnlocked ? (
                        <form className="composer" onSubmit={(event) => {
                          event.preventDefault();
                          void handleCompleteSettlement();
                    }}>
                      <label>
                        <span>Settlement receipt</span>
                        <textarea
                          onChange={(event) => setSettlementReceipt(event.target.value)}
                          placeholder="Private closeout completed. Winning counterparty remains permissioned."
                          rows={4}
                          value={settlementReceipt}
                        />
                      </label>
                      <div className="composer-footer">
                        <p>Seller closes the listing by writing the final receipt onchain.</p>
                        <button
                          className="primary-button"
                          disabled={busyAction !== null}
                          type="submit"
                        >
                          {busyAction === "completeSettlement"
                            ? "Settling..."
                            : "Complete settlement"}
                        </button>
                      </div>
                        </form>
                      ) : (
                        <p className="panel-copy">
                          {selectedListing.status === "closed"
                            ? "Settlement is complete and the receipt is now part of the listing state."
                            : selectedListing.status === "archived"
                              ? "This listing has been archived from the active board, but the final receipt remains onchain."
                              : "Settlement becomes available after the seller selects a winner and the runtime gate is satisfied."}
                        </p>
                      )}
                      {selectedListing.status === "closed" && isSeller ? (
                        <div className="closeout-actions">
                          <p className="micro-copy">
                            Archive this room to remove it from the active board while preserving the onchain receipt.
                          </p>
                          <button
                            className="secondary-button"
                            disabled={busyAction !== null}
                            onClick={() => void handleArchiveListing()}
                            type="button"
                          >
                            {busyAction === "archiveListing" ? "Archiving..." : "Archive listing"}
                          </button>
                        </div>
                      ) : null}
                    </section>

                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <div className="section-label">Integration seam</div>
                      <h3>MagicBlock checklist</h3>
                    </div>
                  </div>
                  <ul className="checklist">
                    {magicBlockIntegrationChecklist.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              </div>
            )}
          </div>
        )}

        {activeTab === "runtime" && (
          <div className="tab-panel" key="runtime">
            <WalletRuntimePanel />
          </div>
        )}
      </div>
    </div>
  );
}

function WalletList({
  currentWallet,
  entries,
  seller,
}: {
  currentWallet: string | null;
  entries: string[];
  seller: string;
}) {
  return (
    <div className="participant-block">
      <div className="participant-heading">
        <span>Allowlisted buyers</span>
        <small>{entries.length} wallets</small>
      </div>
      <div className="participant-list">
        {entries.length === 0 ? (
          <div className="participant blocked">
            <div>
              <strong>No allowlisted buyers yet</strong>
              <span>Seller must update the room to admit bidders.</span>
            </div>
          </div>
        ) : (
          entries.map((address) => (
            <div
              key={address}
              className={
                address === currentWallet ? "participant allowed current" : "participant allowed"
              }
            >
              <div>
                <strong>{shortenAddress(address)}</strong>
                <span>{address === seller ? "Seller" : "Allowlisted bidder"}</span>
              </div>
              <small>{address}</small>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function buildMilestones(
  listing: ListingRecord | null,
  runtimeReady: boolean,
  runtimeState: ReturnType<typeof useMagicBlockRuntime>["state"],
  bidCount: number,
): Milestone[] {
  if (listing === null) {
    return [
      {
        id: "empty",
        label: "Awaiting listing",
        detail: "Create the first onchain listing to initialize the room.",
        complete: false,
      },
    ];
  }

  return [
    {
      id: "listing",
      label: "Listing initialized",
      detail:
        "The public listing shell exists onchain. Private terms live in a delegated mirror account.",
      complete: true,
    },
    {
      id: "runtime",
      label: "Runtime ready",
      detail: runtimeReady
        ? "TEE verification and PER auth are live for the connected wallet."
        : runtimeState.integrityVerified
          ? "TEE verified. Issue a PER auth token next."
          : "Wallet runtime still needs verification before the room unlocks.",
      complete: runtimeReady,
    },
    {
      id: "review",
      label: "Order book review",
      detail:
        listing.status === "bidding"
          ? `${bidCount} bid shell${bidCount === 1 ? "" : "s"} currently recorded.`
          : listing.status === "review"
            ? "Seller can inspect private bid economics and choose a winner."
            : "Seller already moved the book beyond bidding.",
      complete: listing.status !== "bidding",
    },
    {
      id: "settlement",
      label: "Settlement",
      detail:
        listing.status === "archived"
          ? "Settlement is finalized and the room has been archived from the active board."
          : listing.status === "closed"
          ? "Final receipt is now stored on the listing account."
          : listing.status === "settling"
            ? "Winner selected. Seller can now write the final settlement receipt."
            : "Settlement begins after the seller selects a winner.",
      complete: listing.status === "closed" || listing.status === "archived",
    },
  ];
}

function getAccessSummary(
  listing: ListingRecord | null,
  walletAddress: string | null,
  roomUnlocked: boolean,
  runtimeReady: boolean,
): string {
  if (listing === null) {
    return "Create a listing or connect to an existing program-backed room.";
  }

  if (walletAddress === null) {
    return "Connected runtime is required for writes. Public wrappers still load read-only from chain.";
  }

  if (listing.seller === walletAddress) {
    return roomUnlocked
      ? "Seller view unlocked. You can inspect delegated private terms, review private bids, and settle the room."
      : "Seller wallet detected. Complete the runtime auth path to unlock the private delegated room controls.";
  }

  if (!listing.allowlist.includes(walletAddress)) {
    return "This wallet is not allowlisted for the selected listing. Public data is visible, private room data stays redacted.";
  }

  if (roomUnlocked) {
    return "Buyer wallet allowlisted and runtime-ready. The private room is unlocked for this listing.";
  }

  if (runtimeReady) {
    return "Runtime is ready, but the room still needs to be opened from the current wallet context.";
  }

  return "Buyer wallet is allowlisted, but the MagicBlock runtime still needs verification and auth.";
}

function getWalletRoleLabel(listing: ListingRecord | null, walletAddress: string | null): string {
  if (walletAddress === null) {
    return "Disconnected";
  }

  if (listing === null) {
    return "Connected";
  }

  if (listing.seller === walletAddress) {
    return "Seller";
  }

  if (listing.allowlist.includes(walletAddress)) {
    return "Buyer";
  }

  return "Observer";
}

function getRoomGateTitle(
  listing: ListingRecord,
  walletAddress: string | null,
  roomUnlocked: boolean,
  runtimeReady: boolean,
): string {
  if (walletAddress === null) {
    return "Connect wallet to continue.";
  }

  if (!listing.allowlist.includes(walletAddress) && listing.seller !== walletAddress) {
    return "This wallet is not in the room allowlist.";
  }

  if (roomUnlocked) {
    return "Private room unlocked.";
  }

  if (runtimeReady) {
    return "Runtime ready. Open the room.";
  }

  return "Runtime verification still required.";
}

function getRoomGateBody(
  listing: ListingRecord,
  walletAddress: string | null,
  roomUnlocked: boolean,
  runtimeReady: boolean,
): string {
  if (walletAddress === null) {
    return "The onchain listing is public, but hidden room data and seller controls require a connected wallet.";
  }

  if (!listing.allowlist.includes(walletAddress) && listing.seller !== walletAddress) {
    return "This wallet can inspect the public wrapper, but hidden terms and bid actions remain blocked.";
  }

  if (roomUnlocked) {
    return "The connected wallet passed the MagicBlock runtime checks and can read the delegated private mirror accounts for this room.";
  }

  if (runtimeReady) {
    return "The runtime is ready. The next step is using the unlocked room flow from this wallet.";
  }

  return "Verify the TEE endpoint and issue a PER auth token before the room reveals hidden state.";
}

function getSellerActionLabel(status: ListingStatus): string {
  if (status === "bidding") {
    return "Seller can close bidding after enough buyer interest.";
  }

  if (status === "review") {
    return "Seller now has enough information to choose a winner.";
  }

  if (status === "settling") {
    return "A winner exists and settlement receipt can now be published.";
  }

  if (status === "archived") {
    return "The room is archived from the active board, but its receipt and state remain onchain.";
  }

  return "The room has been settled and the final receipt is onchain.";
}

function getListingClockLabel(listing: ListingRecord | null, bidCount: number): string {
  if (listing === null) {
    return "No listing selected";
  }

  if (listing.status === "bidding") {
    return `${bidCount} bid${bidCount === 1 ? "" : "s"} live`;
  }

  if (listing.status === "review") {
    return "Seller reviewing";
  }

  if (listing.status === "settling") {
    return "Settlement in motion";
  }

  if (listing.status === "archived") {
    return "Archived";
  }

  return "Closed";
}

function getRuntimeMetaLabel(
  runtimeState: ReturnType<typeof useMagicBlockRuntime>["state"],
): string {
  if (runtimeState.authToken) {
    return "Auth ready";
  }

  if (runtimeState.integrityVerified) {
    return "TEE verified";
  }

  return "Runtime idle";
}

function shouldRevealBid(
  bid: BidRecord,
  _listing: ListingRecord,
  walletAddress: string | null,
  isSeller: boolean,
): boolean {
  if (walletAddress === null) {
    return false;
  }

  if (!bid.privateLoaded) {
    return false;
  }

  if (isSeller) {
    return true;
  }

  return bid.bidder === walletAddress;
}

function parseAllowlistInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function formatAskRange(listing: ListingRecord): string {
  return `${formatCurrencyValue(listing.askMinUsd)} - ${formatCurrencyValue(listing.askMaxUsd)}`;
}

function formatCurrencyValue(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDraftPreview(value: string): string {
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  return numeric > 0 ? formatCurrencyValue(numeric) : "$0";
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRuntimeIntegrity(
  integrityVerified: boolean | null,
  checkedAt: number | null,
): string {
  if (integrityVerified === null || checkedAt === null) {
    return "Not run";
  }

  const label = new Date(checkedAt).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${integrityVerified ? "Passed" : "Failed"} · ${label}`;
}

function getRuntimeNoticeTitle(tone: string | undefined): string {
  if (tone === "success") {
    return "Verified";
  }

  if (tone === "warning") {
    return "Check required";
  }

  if (tone === "error") {
    return "Action failed";
  }

  return "Next step";
}

export default App;
