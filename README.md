# VeilOTC

[Live Site](https://privacy-otc.vercel.app/) · [Demo Video](https://youtu.be/j5vxsJj3DlE)

[![Watch the VeilOTC demo](https://img.youtube.com/vi/j5vxsJj3DlE/maxresdefault.jpg)](https://youtu.be/j5vxsJj3DlE)

VeilOTC is a private OTC marketplace on Solana built for the MagicBlock privacy track. Sellers publish a public listing shell on devnet, gate hidden deal terms behind MagicBlock runtime auth, accept sealed bids through delegated private accounts, select a winner, settle the deal onchain, and archive old listings from the active board.

## What is live

- Real VeilOTC Anchor program deployed on devnet
- Real public listing and bid shell accounts
- MagicBlock-backed private listing terms and private bid economics
- Wallet connect, TEE verification, and PER auth token flow
- Seller review, winner selection, settlement receipt publishing, and seller-only archive flow

## Stack

- React + Vite frontend
- Anchor program in `programs/veil_otc`
- Solana devnet
- MagicBlock Ephemeral Rollups / permission delegation
- Phantom and Solflare wallet support

## Repo layout

- `src/App.tsx`: main dashboard and seller/buyer UX
- `src/lib/veilOtcProgram.ts`: program client, transaction builders, privacy hydration
- `src/lib/magicblock.ts`: MagicBlock runtime configuration helpers
- `src/providers/MagicBlockRuntimeProvider.tsx`: shared wallet/runtime state
- `programs/veil_otc/src/lib.rs`: onchain listing, bid, settlement, and archive logic
- `src/idl/veil_otc.json`: frontend IDL used by the Anchor client

## Local development

### Frontend

```bash
npm install
npm run dev
```

### Program

```bash
anchor build
anchor deploy
```

The frontend defaults to the program ID embedded in `src/idl/veil_otc.json`. Override it with `VITE_OTC_PROGRAM_ID` if you deploy a fresh program.

## Environment

All env vars are optional unless you are changing defaults.

```bash
VITE_OTC_PROGRAM_ID=
VITE_SOLANA_CLUSTER=devnet
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_PRIVATE_RPC_URL=https://tee.magicblock.app
VITE_PER_VALIDATOR=
VITE_SESSION_TARGET_PROGRAM_ID=
VITE_SESSION_TOP_UP_LAMPORTS=
VITE_SESSION_VALIDITY_MINUTES=
VITE_ENABLE_TX_TRACE=false
```

Notes:

- `VITE_SESSION_TARGET_PROGRAM_ID` is required for real Session Key creation in the runtime tab.
- `VITE_ENABLE_TX_TRACE=true` re-enables verbose private transaction tracing in the browser console for debugging.

## Demo flow

1. Connect seller wallet.
2. Verify TEE RPC and issue PER auth token.
3. Create a listing with hidden terms and an allowlist.
4. Connect an allowlisted buyer wallet, verify runtime, and place a bid.
5. Return to the seller wallet, close bidding, select a winner, and complete settlement.
6. Archive the closed listing to remove it from the active board.

## Current behavior

- Listings and bids are fetched from onchain program accounts, not local browser storage.
- Archived listings are hidden by default and can be revealed from the room board toggle.
- Private listing terms and bid values only load for the seller or the relevant allowlisted bidder after runtime auth succeeds.

## Verification

Run:

```bash
npm run build
anchor build
```
