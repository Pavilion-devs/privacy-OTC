export type ListingStatus = "bidding" | "review" | "settling" | "closed" | "archived";

export type BidStatus = "sealed" | "selected";

export interface ListingRecord {
  address: string;
  allowlist: string[];
  askMaxUsd: number;
  askMinUsd: number;
  assetName: string;
  category: string;
  createdAt: number;
  hiddenTerms: string;
  privateDetails: string;
  privateLoaded: boolean;
  seed: string;
  seller: string;
  settlementAsset: string;
  settlementReceipt: string;
  status: ListingStatus;
  summary: string;
  symbol: string;
  updatedAt: number;
  winningBid: string | null;
}

export interface BidRecord {
  address: string;
  allocationBps: number;
  bidder: string;
  createdAt: number;
  listingId: string;
  note: string;
  priceUsd: number;
  privateDetails: string;
  privateLoaded: boolean;
  status: BidStatus;
  updatedAt: number;
}

export interface Milestone {
  id: string;
  label: string;
  detail: string;
  complete: boolean;
}
