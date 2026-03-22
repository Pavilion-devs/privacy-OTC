import { ComponentType, ReactNode, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import {
  MAGICBLOCK_SOLANA_CLUSTER,
  MAGICBLOCK_SOLANA_RPC_URL,
} from "../lib/magicblock";
import { MagicBlockRuntimeProvider } from "./MagicBlockRuntimeProvider";

interface AppProvidersProps {
  children: ReactNode;
}

const StableConnectionProvider = ConnectionProvider as unknown as ComponentType<{
  children: ReactNode;
  endpoint: string;
}>;

const StableWalletProvider = WalletProvider as unknown as ComponentType<{
  children: ReactNode;
  wallets: unknown[];
  autoConnect?: boolean;
}>;

const StableWalletModalProvider = WalletModalProvider as unknown as ComponentType<{
  children: ReactNode;
}>;

export function AppProviders({ children }: AppProvidersProps) {
  const solflareNetwork =
    MAGICBLOCK_SOLANA_CLUSTER === "mainnet-beta"
      ? WalletAdapterNetwork.Mainnet
      : MAGICBLOCK_SOLANA_CLUSTER === "testnet"
        ? WalletAdapterNetwork.Testnet
        : WalletAdapterNetwork.Devnet;

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({
        network: solflareNetwork,
      }),
    ],
    [solflareNetwork],
  );

  return (
    <StableConnectionProvider endpoint={MAGICBLOCK_SOLANA_RPC_URL}>
      <StableWalletProvider autoConnect wallets={wallets}>
        <StableWalletModalProvider>
          <MagicBlockRuntimeProvider>{children}</MagicBlockRuntimeProvider>
        </StableWalletModalProvider>
      </StableWalletProvider>
    </StableConnectionProvider>
  );
}
