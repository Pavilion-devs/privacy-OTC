/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOLANA_CLUSTER?: "devnet" | "mainnet-beta" | "testnet" | "localnet";
  readonly VITE_SOLANA_RPC_URL?: string;
  readonly VITE_PRIVATE_RPC_URL?: string;
  readonly VITE_SESSION_TARGET_PROGRAM_ID?: string;
  readonly VITE_SESSION_TOP_UP_LAMPORTS?: string;
  readonly VITE_SESSION_VALIDITY_MINUTES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
