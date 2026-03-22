export type ListingStatus = "bidding" | "review" | "settling" | "closed";

export type ParticipantRole = "seller" | "buyer" | "observer";

export interface Participant {
  id: string;
  name: string;
  handle: string;
  role: ParticipantRole;
  accessGranted: boolean;
  jurisdiction: string;
}

export interface Listing {
  id: string;
  assetName: string;
  symbol: string;
  seller: string;
  category: string;
  structure: string;
  status: ListingStatus;
  settlementAsset: string;
  askRange: string;
  timelineLabel: string;
  visibility: string;
  summary: string;
  hiddenTerms: string[];
}

export interface Bid {
  id: string;
  listingId: string;
  bidderId: string;
  priceLabel: string;
  allocationLabel: string;
  submittedAt: string;
  status: "sealed" | "leading" | "selected" | "expired";
}

export interface Milestone {
  id: string;
  label: string;
  detail: string;
  complete: boolean;
}

export interface Settlement {
  listingId: string;
  transferMode: string;
  privacyMode: string;
  status: "ready" | "pending" | "complete";
  receipt: string;
}
