import { startTransition, useMemo, useState } from "react";
import { bids as seededBids, listings, participants, settlements as seededSettlements } from "./data/mockData";
import {
  composeSettlementReceipt,
  magicBlockIntegrationChecklist,
} from "./lib/magicblock";
import { WalletRuntimePanel } from "./components/WalletRuntimePanel";
import { Bid, ListingStatus, Milestone, Participant, Settlement } from "./types";

type ViewerId = Participant["id"] | "judge";
type ViewerRole = Participant["role"] | "judge";
type ActivityTone = "seller" | "buyer" | "system";
type BusyAction =
  | "attest"
  | "token"
  | "submitBid"
  | "closeBidding"
  | "selectWinner"
  | "completeSettlement"
  | null;

interface DemoViewer {
  id: ViewerId;
  name: string;
  handle: string;
  role: ViewerRole;
  accessGranted: boolean;
  jurisdiction: string;
  note: string;
}

interface ActivityEntry {
  id: string;
  listingId: string;
  actor: string;
  detail: string;
  tone: ActivityTone;
}

interface BidDraft {
  price: string;
  allocation: string;
  note: string;
}

interface DemoRoomSession {
  attested: boolean;
  tokenIssued: boolean;
  endpoint: string;
  status: "idle" | "attesting" | "attested" | "issuing" | "ready";
  authTokenPreview: string | null;
}

const viewers: DemoViewer[] = [
  ...participants.map((participant) => ({
    id: participant.id,
    name: participant.name,
    handle: participant.handle,
    role: participant.role,
    accessGranted: participant.role === "seller" || participant.accessGranted,
    jurisdiction: participant.jurisdiction,
    note:
      participant.role === "seller"
        ? "Closes the room, reviews sealed bids, and settles privately."
        : participant.accessGranted
          ? "Allowlisted to attest the room and submit sealed bids."
          : "Blocked until the seller extends buyer permissions.",
  })),
  {
    id: "judge",
    name: "Judge Console",
    handle: "@judge",
    role: "judge",
    accessGranted: false,
    jurisdiction: "Demo",
    note: "Stays outside the room and audits the product flow.",
  },
];

const emptySession: DemoRoomSession = {
  attested: false,
  tokenIssued: false,
  endpoint: "https://tee.magicblock.app",
  status: "idle",
  authTokenPreview: null,
};

const initialActivity: ActivityEntry[] = [
  {
    id: "activity-1",
    listingId: "listing-1",
    actor: "Room engine",
    detail: "Listing published with public teaser metadata and hidden terms in PER.",
    tone: "system",
  },
  {
    id: "activity-2",
    listingId: "listing-1",
    actor: "Astra Treasury",
    detail: "Allowlisted Northstar Capital and Glasswater Ventures for private reads.",
    tone: "seller",
  },
  {
    id: "activity-3",
    listingId: "listing-1",
    actor: "Northstar Capital",
    detail: "Seeded the room with an opening sealed bid.",
    tone: "buyer",
  },
  {
    id: "activity-4",
    listingId: "listing-2",
    actor: "Founders Syndicate",
    detail: "Closed bidding and moved the Orbit SAFE room into seller review.",
    tone: "seller",
  },
];

function App() {
  const [selectedListingId, setSelectedListingId] = useState(listings[0].id);
  const [activeViewerId, setActiveViewerId] = useState<ViewerId>("buyer-1");
  const [listingStatusById, setListingStatusById] = useState<Record<string, ListingStatus>>(
    () =>
      Object.fromEntries(listings.map((listing) => [listing.id, listing.status])) as Record<
        string,
        ListingStatus
      >,
  );
  const [roomBids, setRoomBids] = useState<Bid[]>(seededBids);
  const [settlementByListing, setSettlementByListing] = useState<Record<string, Settlement>>(
    () =>
      Object.fromEntries(
        seededSettlements.map((settlement) => [settlement.listingId, settlement]),
      ) as Record<string, Settlement>,
  );
  const [sessionByKey, setSessionByKey] = useState<Record<string, DemoRoomSession>>({});
  const [bidDraftByKey, setBidDraftByKey] = useState<Record<string, BidDraft>>({});
  const [activity, setActivity] = useState<ActivityEntry[]>(initialActivity);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [page, setPage] = useState<"landing" | "dashboard">("landing");
  const [activeTab, setActiveTab] = useState<"rooms" | "orderbook" | "settlement" | "runtime">("rooms");

  const participantMap = useMemo(
    () => new Map(participants.map((participant) => [participant.id, participant])),
    [],
  );

  const renderedListings = useMemo(
    () =>
      listings.map((listing) => {
        const status = listingStatusById[listing.id] ?? listing.status;
        const bidCount = roomBids.filter((bid) => bid.listingId === listing.id).length;
        const settlement = settlementByListing[listing.id];

        return {
          ...listing,
          status,
          timelineLabel: getTimelineLabel(status, bidCount, settlement.status),
        };
      }),
    [listingStatusById, roomBids, settlementByListing],
  );

  const selectedListing =
    renderedListings.find((listing) => listing.id === selectedListingId) ?? renderedListings[0];
  const activeViewer = viewers.find((viewer) => viewer.id === activeViewerId) ?? viewers[0];
  const activeParticipant =
    activeViewer.role === "judge"
      ? null
      : participants.find((participant) => participant.id === activeViewer.id) ?? null;
  const sessionKey = `${selectedListing.id}:${activeViewer.id}`;
  const session = sessionByKey[sessionKey] ?? emptySession;
  const settlement = settlementByListing[selectedListing.id];
  const listingBids = useMemo(
    () =>
      roomBids
        .filter((bid) => bid.listingId === selectedListing.id)
        .sort((left, right) => getPriceValue(right.priceLabel) - getPriceValue(left.priceLabel)),
    [roomBids, selectedListing.id],
  );
  const selectedBid = listingBids.find((bid) => bid.status === "selected") ?? null;
  const winningBidder =
    selectedBid === null ? null : participantMap.get(selectedBid.bidderId) ?? null;
  const activityForListing = activity
    .filter((entry) => entry.listingId === selectedListing.id)
    .slice(0, 6);
  const allowedParticipants = participants.filter((participant) => participant.accessGranted);
  const blockedParticipants = participants.filter((participant) => !participant.accessGranted);
  const currentBidDraft = bidDraftByKey[sessionKey] ?? getDefaultDraft(selectedListing.id);
  const viewerHasPrivateAccess = Boolean(
    activeParticipant && (activeParticipant.role === "seller" || activeParticipant.accessGranted),
  );
  const roomUnlocked = viewerHasPrivateAccess && session.tokenIssued;
  const sellerControlsEnabled =
    activeParticipant?.role === "seller" && roomUnlocked && busyAction === null;
  const bidderCanCompose =
    activeParticipant?.role === "buyer" &&
    activeParticipant.accessGranted &&
    selectedListing.status === "bidding" &&
    roomUnlocked &&
    busyAction === null;
  const bidderExistingBid =
    activeParticipant?.role === "buyer"
      ? listingBids.find((bid) => bid.bidderId === activeParticipant.id) ?? null
      : null;
  const timeline = buildMilestones(
    selectedListing.status,
    session,
    selectedBid !== null,
    settlement.status,
  );
  const sellerActionLabel = getSellerActionLabel(selectedListing.status);
  const accessSummary = getAccessSummary(activeViewer, viewerHasPrivateAccess, roomUnlocked, session);

  function appendActivity(entry: Omit<ActivityEntry, "id">) {
    startTransition(() => {
      setActivity((previous) => [
        {
          id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          ...entry,
        },
        ...previous,
      ]);
    });
  }

  function updateBidDraft(patch: Partial<BidDraft>) {
    setBidDraftByKey((previous) => ({
      ...previous,
      [sessionKey]: {
        ...(previous[sessionKey] ?? getDefaultDraft(selectedListing.id)),
        ...patch,
      },
    }));
  }

  async function handleAttestSession() {
    if (!activeParticipant || !viewerHasPrivateAccess) {
      return;
    }

    setBusyAction("attest");

    const bootstrapped = sessionByKey[sessionKey] ?? emptySession;
    setSessionByKey((previous) => ({
      ...previous,
      [sessionKey]: {
        ...bootstrapped,
        status: "attesting",
      },
    }));

    await wait(250);

    const nextSession: DemoRoomSession = {
      ...bootstrapped,
      attested: true,
      tokenIssued: false,
      status: "attested",
      authTokenPreview: null,
    };
    setSessionByKey((previous) => ({
      ...previous,
      [sessionKey]: nextSession,
    }));
    appendActivity({
      listingId: selectedListing.id,
      actor: activeParticipant.name,
      detail: "Attested the TEE room and verified the secure execution endpoint.",
      tone: activeParticipant.role === "seller" ? "seller" : "buyer",
    });
    setBusyAction(null);
  }

  async function handleIssueToken() {
    if (!activeParticipant || !viewerHasPrivateAccess || !session.attested) {
      return;
    }

    setBusyAction("token");

    const nextShell = {
      ...session,
      status: "issuing" as const,
    };
    setSessionByKey((previous) => ({
      ...previous,
      [sessionKey]: nextShell,
    }));

    await wait(250);

    const nextSession: DemoRoomSession = {
      ...nextShell,
      tokenIssued: true,
      status: "ready",
      authTokenPreview: `demo_${Math.random().toString(36).slice(2, 8)}`,
    };
    setSessionByKey((previous) => ({
      ...previous,
      [sessionKey]: nextSession,
    }));
    appendActivity({
      listingId: selectedListing.id,
      actor: activeParticipant.name,
      detail: "Minted a short-lived auth token for permissioned PER reads.",
      tone: activeParticipant.role === "seller" ? "seller" : "buyer",
    });
    setBusyAction(null);
  }

  function handleSubmitBid(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeParticipant || activeParticipant.role !== "buyer" || !bidderCanCompose) {
      return;
    }

    const priceValue = Number(currentBidDraft.price.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      return;
    }

    setBusyAction("submitBid");

    const submittedBid: Bid = {
      id: `bid-${Date.now()}`,
      listingId: selectedListing.id,
      bidderId: activeParticipant.id,
      priceLabel: formatCurrencyValue(priceValue),
      allocationLabel: currentBidDraft.allocation.trim() || "100% fill",
      submittedAt: getUtcTimeLabel(),
      status: "sealed",
    };

    setRoomBids((previous) => [
      ...previous.filter(
        (bid) =>
          !(bid.listingId === selectedListing.id && bid.bidderId === activeParticipant.id),
      ),
      submittedBid,
    ]);
    appendActivity({
      listingId: selectedListing.id,
      actor: activeParticipant.name,
      detail: currentBidDraft.note.trim()
        ? `Updated a sealed bid at ${submittedBid.priceLabel} for ${submittedBid.allocationLabel}. Note: ${currentBidDraft.note.trim()}`
        : `Updated a sealed bid at ${submittedBid.priceLabel} for ${submittedBid.allocationLabel}.`,
      tone: "buyer",
    });
    setBusyAction(null);
  }

  function handleCloseBidding() {
    if (!activeParticipant || activeParticipant.role !== "seller" || !sellerControlsEnabled) {
      return;
    }

    setBusyAction("closeBidding");

    const roomBidsForListing = roomBids
      .filter((bid) => bid.listingId === selectedListing.id)
      .sort((left, right) => getPriceValue(right.priceLabel) - getPriceValue(left.priceLabel));
    const leadingBidId = roomBidsForListing[0]?.id ?? null;

    setRoomBids((previous) =>
      previous.map((bid) => {
        if (bid.listingId !== selectedListing.id) {
          return bid;
        }

        if (leadingBidId !== null && bid.id === leadingBidId) {
          return { ...bid, status: "leading" as const };
        }

        return { ...bid, status: "sealed" as const };
      }),
    );
    setListingStatusById((previous) => ({
      ...previous,
      [selectedListing.id]: "review",
    }));
    appendActivity({
      listingId: selectedListing.id,
      actor: activeParticipant.name,
      detail:
        roomBidsForListing.length === 0
          ? "Closed the room with no qualifying bids."
          : `Closed bidding and opened seller review for ${roomBidsForListing.length} sealed submissions.`,
      tone: "seller",
    });
    setBusyAction(null);
  }

  function handleSelectWinner(bidId: string) {
    if (
      !activeParticipant ||
      activeParticipant.role !== "seller" ||
      !sellerControlsEnabled ||
      selectedListing.status !== "review"
    ) {
      return;
    }

    setBusyAction("selectWinner");

    const nextWinningBid = listingBids.find((bid) => bid.id === bidId) ?? null;
    if (nextWinningBid === null) {
      setBusyAction(null);
      return;
    }

    const nextWinningBidder = participantMap.get(nextWinningBid.bidderId);

    setRoomBids((previous) =>
      previous.map((bid) => {
        if (bid.listingId !== selectedListing.id) {
          return bid;
        }

        if (bid.id === bidId) {
          return { ...bid, status: "selected" as const };
        }

        return { ...bid, status: "expired" as const };
      }),
    );
    setListingStatusById((previous) => ({
      ...previous,
      [selectedListing.id]: "settling",
    }));
    setSettlementByListing((previous) => ({
      ...previous,
      [selectedListing.id]: {
        ...previous[selectedListing.id],
        status: "pending",
        receipt: composeSettlementReceipt(
          selectedListing.assetName,
          nextWinningBidder?.name ?? "Selected bidder",
        ),
      },
    }));
    appendActivity({
      listingId: selectedListing.id,
      actor: activeParticipant.name,
      detail: `Selected ${nextWinningBidder?.name ?? "the winning bidder"} for private settlement.`,
      tone: "seller",
    });
    setBusyAction(null);
  }

  function handleCompleteSettlement() {
    if (
      !activeParticipant ||
      activeParticipant.role !== "seller" ||
      !sellerControlsEnabled ||
      selectedListing.status !== "settling"
    ) {
      return;
    }

    setBusyAction("completeSettlement");

    setListingStatusById((previous) => ({
      ...previous,
      [selectedListing.id]: "closed",
    }));
    setSettlementByListing((previous) => ({
      ...previous,
      [selectedListing.id]: {
        ...previous[selectedListing.id],
        status: "complete",
        receipt:
          winningBidder === null
            ? "Private closeout published with counterparty details redacted."
            : `Private closeout completed for ${winningBidder.name}; losing bids remained sealed.`,
      },
    }));
    appendActivity({
      listingId: selectedListing.id,
      actor: activeParticipant.name,
      detail: "Completed private settlement and published a redacted public receipt.",
      tone: "seller",
    });
    setBusyAction(null);
  }

  if (page === "landing") {
    return (
      <div className="landing">
        <div className="landing-orb" />
        <div className="landing-content">
          <span className="landing-eyebrow">MagicBlock Privacy Track</span>
          <h1 className="landing-title">Private OTC Marketplace</h1>
          <p className="landing-tagline">
            Confidential deal rooms for illiquid assets on Solana. Sealed bids,
            permissioned access, private settlement — powered by TEE-backed execution.
          </p>
          <div className="landing-features">
            <div className="landing-feature">
              <strong>Privacy by default</strong>
              <span>
                Terms, bids, and settlement logic stay inside permissioned rooms.
                Only public teasers are visible until a wallet attests and authenticates.
              </span>
            </div>
            <div className="landing-feature">
              <strong>Institutional-grade flow</strong>
              <span>
                Sealed-bid auctions, seller-controlled access lists, and private
                closeout receipts — built for real OTC deal structure.
              </span>
            </div>
          </div>
          <button className="landing-cta" onClick={() => setPage("dashboard")} type="button">
            Enter Marketplace
          </button>
          <span className="landing-footnote">Demo environment · No real assets</span>
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
            onKeyDown={(e) => e.key === "Enter" && setPage("landing")}
          >
            Private OTC
          </span>
          <span className="dash-separator">·</span>
          <span className="dash-room-name">{selectedListing.assetName}</span>
        </div>
        <div className="dash-nav-right">
          <select
            className="viewer-select"
            value={activeViewerId}
            onChange={(e) => setActiveViewerId(e.target.value as ViewerId)}
          >
            {viewers.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.role})
              </option>
            ))}
          </select>
          <span className={`status ${selectedListing.status}`}>{selectedListing.status}</span>
        </div>
      </nav>

      <div className="dash-context">
        <p className="dash-context-text">{accessSummary}</p>
        <div className="dash-context-meta">
          <span>{activeViewer.role === "judge" ? "Observer" : activeViewer.role}</span>
          <span>{activeViewer.jurisdiction}</span>
          <span>{selectedListing.timelineLabel}</span>
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
        {activeTab === "rooms" && (
          <div className="tab-panel" key="rooms">
            <section className="listing-grid">
              {renderedListings.map((listing) => (
                <button
                  key={listing.id}
                  className={
                    listing.id === selectedListing.id ? "listing-card active" : "listing-card"
                  }
                  onClick={() => setSelectedListingId(listing.id)}
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
                      <dt>Structure</dt>
                      <dd>{listing.structure}</dd>
                    </div>
                    <div>
                      <dt>Ask range</dt>
                      <dd>{listing.askRange}</dd>
                    </div>
                    <div>
                      <dt>Visibility</dt>
                      <dd>{listing.visibility}</dd>
                    </div>
                    <div>
                      <dt>Clock</dt>
                      <dd>{listing.timelineLabel}</dd>
                    </div>
                  </dl>
                </button>
              ))}
            </section>

            <div className="room-detail">
              <div className="room-detail-header">
                <div>
                  <div className="section-label">Selected room</div>
                  <h3>{selectedListing.assetName}</h3>
                </div>
                <span className={`status ${selectedListing.status}`}>
                  {selectedListing.status}
                </span>
              </div>

              <div className="room-gate">
                <strong>
                  {getRoomGateTitle(activeViewer, viewerHasPrivateAccess, roomUnlocked, session)}
                </strong>
                <p>
                  {getRoomGateBody(activeViewer, viewerHasPrivateAccess, roomUnlocked, session)}
                </p>
              </div>

              <div className="detail-grid">
                <div className="detail-card">
                  <div className="section-label">Public wrapper</div>
                  <p>
                    {selectedListing.symbol} sale by {selectedListing.seller}. Settlement in{" "}
                    {selectedListing.settlementAsset}.
                  </p>
                  <p className="muted-copy">
                    Anyone can discover the listing. Only authorized wallets can read exact terms,
                    unlock schedules, and sealed order flow.
                  </p>
                </div>
                <div className="detail-card">
                  <div className="section-label">Private room terms</div>
                  {roomUnlocked ? (
                    <ul className="text-list">
                      {selectedListing.hiddenTerms.map((term) => (
                        <li key={term}>{term}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="placeholder-stack">
                      <span className="placeholder-chip">Unlock schedule redacted</span>
                      <span className="placeholder-chip">Reserve price redacted</span>
                      <span className="placeholder-chip">Settlement instructions redacted</span>
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
                    <h3>TEE session</h3>
                  </div>
                  <span className={`status ${getSessionStatusTone(session)}`}>
                    {session.status}
                  </span>
                </div>
                {activeViewer.role === "judge" ? (
                  <p className="panel-copy">
                    Judge mode stays outside the private room. Switch to seller or buyer to
                    demonstrate attestation.
                  </p>
                ) : !viewerHasPrivateAccess ? (
                  <p className="panel-copy">
                    This wallet is not in the permission group for the selected room.
                  </p>
                ) : (
                  <>
                    <dl className="settlement-grid compact">
                      <div>
                        <dt>TEE endpoint</dt>
                        <dd>{session.endpoint}</dd>
                      </div>
                      <div>
                        <dt>Auth token</dt>
                        <dd>{session.authTokenPreview ?? "Not issued yet"}</dd>
                      </div>
                    </dl>
                    <div className="button-row">
                      <button
                        className="primary-button"
                        disabled={busyAction !== null}
                        onClick={() => void handleAttestSession()}
                        type="button"
                      >
                        {busyAction === "attest"
                          ? "Attesting..."
                          : session.attested
                            ? "Re-attest"
                            : "Attest TEE RPC"}
                      </button>
                      <button
                        className="secondary-button"
                        disabled={!session.attested || busyAction !== null}
                        onClick={() => void handleIssueToken()}
                        type="button"
                      >
                        {busyAction === "token"
                          ? "Issuing..."
                          : session.tokenIssued
                            ? "Refresh token"
                            : "Issue token"}
                      </button>
                    </div>
                  </>
                )}
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <div className="section-label">Participants</div>
                    <h3>Access control</h3>
                  </div>
                </div>
                <ParticipantList
                  currentViewerId={activeViewer.id}
                  entries={allowedParticipants}
                  title="Allowed"
                  tone="allowed"
                />
                <ParticipantList
                  currentViewerId={activeViewer.id}
                  entries={blockedParticipants}
                  title="Pending / blocked"
                  tone="blocked"
                />
              </section>
            </div>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <div className="section-label">Activity</div>
                  <h3>Room feed</h3>
                </div>
              </div>
              <div className="feed">
                {activityForListing.map((entry) => (
                  <div key={entry.id} className={`feed-item ${entry.tone}`}>
                    <strong>{entry.actor}</strong>
                    <p>{entry.detail}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === "orderbook" && (
          <div className="tab-panel" key="orderbook">
            <section className="panel large">
              <div className="panel-header">
                <div>
                  <div className="section-label">Bids · {selectedListing.assetName}</div>
                  <h3>Sealed order flow</h3>
                </div>
                <span className="micro-copy">{sellerActionLabel}</span>
              </div>

              <div className="action-bar">
                {activeParticipant?.role === "seller" && selectedListing.status === "bidding" ? (
                  <button
                    className="primary-button"
                    disabled={!sellerControlsEnabled}
                    onClick={handleCloseBidding}
                    type="button"
                  >
                    {busyAction === "closeBidding" ? "Closing..." : "Close bidding"}
                  </button>
                ) : null}

                {activeParticipant?.role === "seller" && selectedListing.status === "settling" ? (
                  <button
                    className="primary-button"
                    disabled={!sellerControlsEnabled}
                    onClick={handleCompleteSettlement}
                    type="button"
                  >
                    {busyAction === "completeSettlement" ? "Settling..." : "Complete settlement"}
                  </button>
                ) : null}

                {activeParticipant?.role === "seller" && selectedListing.status === "review" ? (
                  <span className="inline-note">
                    Pick a winner from the reviewed sealed bids.
                  </span>
                ) : null}

                {bidderExistingBid !== null ? (
                  <span className="inline-note">
                    Your current sealed bid: {bidderExistingBid.priceLabel} for{" "}
                    {bidderExistingBid.allocationLabel}.
                  </span>
                ) : null}
              </div>

              {activeViewer.role === "judge" ? (
                <div className="room-gate compact">
                  <strong>Judge view keeps bid contents redacted.</strong>
                  <p>
                    Use seller mode to inspect the reviewed book or buyer mode to prove that only a
                    wallet owner can see its own sealed bid.
                  </p>
                </div>
              ) : !viewerHasPrivateAccess ? (
                <div className="room-gate compact">
                  <strong>Bid wall locked.</strong>
                  <p>This wallet is not allowlisted for the selected room.</p>
                </div>
              ) : !roomUnlocked ? (
                <div className="room-gate compact">
                  <strong>Session not ready.</strong>
                  <p>
                    Attest the room and issue an access token before reading or writing bid state.
                  </p>
                </div>
              ) : (
                <>
                  <div className="bid-list">
                    {listingBids.length === 0 ? (
                      <div className="empty-state">
                        <strong>No bids yet.</strong>
                        <p>
                          Open rooms accept sealed bids from approved buyers once their session is
                          ready.
                        </p>
                      </div>
                    ) : (
                      listingBids.map((bid) => {
                        const bidder = participantMap.get(bid.bidderId);
                        const reveal = shouldRevealBid(
                          bid,
                          activeParticipant,
                          selectedListing.status,
                        );

                        return (
                          <div key={bid.id} className="bid-card">
                            <div>
                              <strong>{bidder?.name ?? "Unknown bidder"}</strong>
                              <span>{reveal ? bid.submittedAt : "Timestamp hidden"}</span>
                            </div>
                            <div className="bid-values">
                              <span>
                                {reveal
                                  ? bid.priceLabel
                                  : "Hidden until room rules allow reveal"}
                              </span>
                              <small>
                                {reveal ? bid.allocationLabel : "sealed allocation"}
                              </small>
                            </div>
                            <div className="bid-action-cell">
                              <span className={`status ${bid.status}`}>{bid.status}</span>
                              {activeParticipant?.role === "seller" &&
                              selectedListing.status === "review" ? (
                                <button
                                  className="secondary-button"
                                  disabled={busyAction !== null || bid.status === "selected"}
                                  onClick={() => handleSelectWinner(bid.id)}
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
                    <form className="composer" onSubmit={handleSubmitBid}>
                      <div className="panel-header tight">
                        <div>
                          <div className="section-label">Bid composer</div>
                          <h3>Submit or revise sealed bid</h3>
                        </div>
                      </div>
                      <div className="form-grid">
                        <label>
                          <span>Price in USD</span>
                          <input
                            inputMode="numeric"
                            onChange={(event) =>
                              updateBidDraft({ price: event.target.value })
                            }
                            placeholder="212000"
                            value={currentBidDraft.price}
                          />
                        </label>
                        <label>
                          <span>Allocation</span>
                          <select
                            onChange={(event) =>
                              updateBidDraft({ allocation: event.target.value })
                            }
                            value={currentBidDraft.allocation}
                          >
                            <option value="100% fill">100% fill</option>
                            <option value="80% fill">80% fill</option>
                            <option value="50% fill">50% fill</option>
                            <option value="Lead ticket">Lead ticket</option>
                          </select>
                        </label>
                      </div>
                      <label>
                        <span>Private note</span>
                        <textarea
                          onChange={(event) =>
                            updateBidDraft({ note: event.target.value })
                          }
                          placeholder="Optional note for demo activity feed"
                          rows={3}
                          value={currentBidDraft.note}
                        />
                      </label>
                      <div className="composer-footer">
                        <p>
                          Sealed preview: {formatDraftPreview(currentBidDraft.price)} for{" "}
                          {currentBidDraft.allocation}
                        </p>
                        <button
                          className="primary-button"
                          disabled={
                            busyAction !== null || currentBidDraft.price.trim() === ""
                          }
                          type="submit"
                        >
                          {busyAction === "submitBid" ? "Sealing..." : "Seal bid in room"}
                        </button>
                      </div>
                    </form>
                  ) : null}
                </>
              )}
            </section>
          </div>
        )}

        {activeTab === "settlement" && (
          <div className="tab-panel" key="settlement">
            <div className="settlement-layout">
              <section className="panel large">
                <div className="panel-header">
                  <div>
                    <div className="section-label">Settlement</div>
                    <h3>Private closeout</h3>
                  </div>
                  <span className={`status ${settlement.status}`}>{settlement.status}</span>
                </div>
                <dl className="settlement-grid">
                  <div>
                    <dt>Transfer rail</dt>
                    <dd>{settlement.transferMode}</dd>
                  </div>
                  <div>
                    <dt>Privacy mode</dt>
                    <dd>{settlement.privacyMode}</dd>
                  </div>
                  <div>
                    <dt>Receipt</dt>
                    <dd>{settlement.receipt}</dd>
                  </div>
                </dl>
                {selectedBid !== null && winningBidder !== null ? (
                  <p className="panel-copy">
                    Winner: {winningBidder.name} at {selectedBid.priceLabel}. This stays inside
                    the room until the seller publishes the final closeout.
                  </p>
                ) : (
                  <p className="panel-copy">
                    No winner has been selected for this room yet. Losing bids remain private even
                    after closeout.
                  </p>
                )}
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <div className="section-label">Integration seam</div>
                    <h3>MagicBlock wiring checklist</h3>
                  </div>
                </div>
                <ul className="checklist">
                  {magicBlockIntegrationChecklist.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            </div>
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

function ParticipantList({
  currentViewerId,
  entries,
  title,
  tone,
}: {
  currentViewerId: ViewerId;
  entries: Participant[];
  title: string;
  tone: "allowed" | "blocked";
}) {
  return (
    <div className="participant-block">
      <div className="participant-heading">
        <span>{title}</span>
        <small>{entries.length} wallets</small>
      </div>
      <div className="participant-list">
        {entries.map((participant) => (
          <div
            key={participant.id}
            className={
              participant.id === currentViewerId
                ? `participant ${tone} current`
                : `participant ${tone}`
            }
          >
            <div>
              <strong>{participant.name}</strong>
              <span>{participant.handle}</span>
            </div>
            <small>{participant.jurisdiction}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function getDefaultDraft(listingId: string): BidDraft {
  if (listingId === "listing-2") {
    return {
      price: "492000",
      allocation: "Lead ticket",
      note: "",
    };
  }

  return {
    price: "212000",
    allocation: "100% fill",
    note: "",
  };
}

function getPriceValue(label: string): number {
  return Number(label.replace(/[^\d.]/g, "")) || 0;
}

function getUtcTimeLabel(): string {
  const label = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date());

  return `${label} UTC`;
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

function getTimelineLabel(
  status: ListingStatus,
  bidCount: number,
  settlementStatus: Settlement["status"],
): string {
  if (status === "bidding") {
    return `${bidCount} sealed ${bidCount === 1 ? "bid" : "bids"} live`;
  }

  if (status === "review") {
    return "Seller reviewing private book";
  }

  if (status === "settling") {
    return settlementStatus === "complete" ? "Private closeout published" : "Settlement in motion";
  }

  return "Privately closed";
}

function buildMilestones(
  status: ListingStatus,
  session: DemoRoomSession,
  hasWinner: boolean,
  settlementStatus: Settlement["status"],
): Milestone[] {
  return [
    {
      id: "listing",
      label: "Listing initialized",
      detail: "Public teaser metadata is live and the private room state exists inside PER.",
      complete: true,
    },
    {
      id: "attestation",
      label: "Attested session",
      detail: session.attested
        ? "TEE quote verified and room endpoint confirmed."
        : "This viewer has not attested the private room yet.",
      complete: session.attested,
    },
    {
      id: "review",
      label: "Order book review",
      detail:
        status === "bidding"
          ? "Bids remain sealed while the room stays open."
          : hasWinner
            ? "Seller closed the book and selected a private winner."
            : "Seller can inspect the book and choose the winning counterparty.",
      complete: status !== "bidding",
    },
    {
      id: "settlement",
      label: "Private settlement",
      detail:
        settlementStatus === "complete"
          ? "Final receipt published without exposing losing bids."
          : status === "settling"
            ? "Private token settlement is pending seller closeout."
            : "Settlement begins after the seller selects a winner.",
      complete: settlementStatus === "complete",
    },
  ];
}

function getSessionStatusTone(session: DemoRoomSession): "ready" | "review" | "bidding" {
  if (session.tokenIssued) {
    return "ready";
  }

  if (session.attested) {
    return "review";
  }

  return "bidding";
}

function getSellerActionLabel(status: ListingStatus): string {
  if (status === "bidding") {
    return "Seller can close bidding after enough buyer interest.";
  }

  if (status === "review") {
    return "Seller now has enough information to choose a winner.";
  }

  if (status === "settling") {
    return "A winner exists and private settlement is pending.";
  }

  return "The room has been settled and publicly redacted.";
}

function getAccessSummary(
  viewer: DemoViewer,
  hasPrivateAccess: boolean,
  roomUnlocked: boolean,
  session: DemoRoomSession,
): string {
  if (viewer.role === "judge") {
    return "Observer mode. Useful for narrating the product flow without touching hidden state.";
  }

  if (!hasPrivateAccess) {
    return "Blocked from private terms until the seller adds this wallet to the room permission group.";
  }

  if (roomUnlocked) {
    return `Room unlocked through ${session.endpoint} with a short-lived access token.`;
  }

  if (session.attested) {
    return "TEE room attested. One more step issues the auth token for PER reads and writes.";
  }

  return "Wallet can enter the room, but still needs attestation before hidden state becomes readable.";
}

function getRoomGateTitle(
  viewer: DemoViewer,
  hasPrivateAccess: boolean,
  roomUnlocked: boolean,
  session: DemoRoomSession,
): string {
  if (viewer.role === "judge") {
    return "Judge mode stays outside the room.";
  }

  if (!hasPrivateAccess) {
    return "This wallet is not in the room permission group.";
  }

  if (roomUnlocked) {
    return "Private room unlocked.";
  }

  if (session.attested) {
    return "Attestation complete. Access token still required.";
  }

  return "Private room waiting for attestation.";
}

function getRoomGateBody(
  viewer: DemoViewer,
  hasPrivateAccess: boolean,
  roomUnlocked: boolean,
  session: DemoRoomSession,
): string {
  if (viewer.role === "judge") {
    return "Use seller or buyer mode to prove that hidden terms and bid contents stay redacted until a wallet attests and authenticates.";
  }

  if (!hasPrivateAccess) {
    return "The listing remains discoverable, but unlock schedules, bid values, and settlement instructions stay hidden from this wallet.";
  }

  if (roomUnlocked) {
    return "This viewer has attested the TEE room, issued a short-lived token, and can now read or write permissioned state.";
  }

  if (session.attested) {
    return "The secure hardware check already passed. Issue an access token next to query the room over the private endpoint.";
  }

  return "Attest the TEE endpoint first. That step proves the private room is running in secure hardware before any hidden state is revealed.";
}

function shouldRevealBid(
  bid: Bid,
  activeParticipant: Participant | null,
  status: ListingStatus,
): boolean {
  if (activeParticipant === null) {
    return false;
  }

  if (activeParticipant.role === "seller") {
    return status !== "bidding";
  }

  return bid.bidderId === activeParticipant.id;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export default App;
