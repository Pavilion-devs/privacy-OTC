import { Bid, Listing, Milestone, Participant, Settlement } from "../types";

export const participants: Participant[] = [
  {
    id: "seller-1",
    name: "Astra Treasury",
    handle: "@astra",
    role: "seller",
    accessGranted: true,
    jurisdiction: "BVI",
  },
  {
    id: "buyer-1",
    name: "Northstar Capital",
    handle: "@northstar",
    role: "buyer",
    accessGranted: true,
    jurisdiction: "Singapore",
  },
  {
    id: "buyer-2",
    name: "Glasswater Ventures",
    handle: "@glasswater",
    role: "buyer",
    accessGranted: true,
    jurisdiction: "UAE",
  },
  {
    id: "buyer-3",
    name: "Open Circle Labs",
    handle: "@opencircle",
    role: "buyer",
    accessGranted: false,
    jurisdiction: "UK",
  },
];

export const listings: Listing[] = [
  {
    id: "listing-1",
    assetName: "Helio Network Locked Allocation",
    symbol: "HELIO",
    seller: "Astra Treasury",
    category: "Vested token sale",
    structure: "Sealed-bid secondary OTC",
    status: "bidding",
    settlementAsset: "USDC",
    askRange: "$180k - $230k",
    timelineLabel: "Closes in 19h",
    visibility: "Public teaser + private terms",
    summary:
      "Treasury sale for a locked token allocation with a transfer window after cliff unlock.",
    hiddenTerms: [
      "Exact unlock schedule visible only to approved buyers",
      "Bid ladder and reserve price remain sealed until close",
      "Settlement uses private transfer rails",
    ],
  },
  {
    id: "listing-2",
    assetName: "Orbit Labs SAFE Round",
    symbol: "SAFE",
    seller: "Founders Syndicate",
    category: "Private venture paper",
    structure: "Invite-only OTC room",
    status: "review",
    settlementAsset: "USDC",
    askRange: "$400k - $550k",
    timelineLabel: "Seller reviewing bids",
    visibility: "Allowlisted buyers only",
    summary:
      "Private SAFE allocation offered to strategic buyers with document access control.",
    hiddenTerms: [
      "Document room sits behind buyer permissions",
      "Only the winning bid is surfaced in the final receipt",
      "Losing bids remain private after settlement",
    ],
  },
];

export const bids: Bid[] = [
  {
    id: "bid-1",
    listingId: "listing-1",
    bidderId: "buyer-1",
    priceLabel: "$208,000",
    allocationLabel: "100% fill",
    submittedAt: "12:24 UTC",
    status: "sealed",
  },
  {
    id: "bid-2",
    listingId: "listing-1",
    bidderId: "buyer-2",
    priceLabel: "$214,000",
    allocationLabel: "80% fill",
    submittedAt: "12:41 UTC",
    status: "sealed",
  },
  {
    id: "bid-3",
    listingId: "listing-2",
    bidderId: "buyer-1",
    priceLabel: "$492,000",
    allocationLabel: "Lead ticket",
    submittedAt: "09:02 UTC",
    status: "leading",
  },
];

export const milestones: Milestone[] = [
  {
    id: "milestone-1",
    label: "Listing initialized",
    detail: "Public metadata published and private state stored in PER.",
    complete: true,
  },
  {
    id: "milestone-2",
    label: "Buyer permissions granted",
    detail: "Approved wallets can attest and read private terms.",
    complete: true,
  },
  {
    id: "milestone-3",
    label: "Sealed bids in progress",
    detail: "Bid amounts are hidden until the room closes.",
    complete: false,
  },
  {
    id: "milestone-4",
    label: "Settlement ready",
    detail: "Winning bidder can settle privately in USDC.",
    complete: false,
  },
];

export const settlements: Settlement[] = [
  {
    listingId: "listing-1",
    transferMode: "Private SPL transfer",
    privacyMode: "TEE-backed PER execution",
    status: "ready",
    receipt: "Receipt published after winner acceptance",
  },
  {
    listingId: "listing-2",
    transferMode: "Private SPL transfer",
    privacyMode: "Permissioned deal room",
    status: "pending",
    receipt: "Settlement receipt waiting for seller approval",
  },
];
