import { ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  useAnchorWallet,
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import type { Connection } from "@solana/web3.js";
import {
  SessionWalletInterface,
  SessionWalletProvider,
  useSessionKeyManager,
} from "@magicblock-labs/gum-react-sdk";
import {
  MAGICBLOCK_PRIVATE_RPC_URL,
  MAGICBLOCK_SOLANA_CLUSTER,
  createPrivateConnection,
  createSessionForProgram,
  requestPrivateAuthToken,
  resolveSessionTargetProgram,
  verifyPrivateRpc,
} from "../lib/magicblock";

export type RuntimeBusyAction =
  | "verify"
  | "auth"
  | "createSession"
  | "revokeSession"
  | null;

export type RuntimeNoticeTone = "info" | "success" | "warning" | "error";

export interface RuntimeNotice {
  tone: RuntimeNoticeTone;
  message: string;
}

export interface MagicBlockRuntimeState {
  integrityVerified: boolean | null;
  integrityCheckedAt: number | null;
  authToken: string | null;
  authExpiresAt: number | null;
  busyAction: RuntimeBusyAction;
  error: string | null;
  notice: RuntimeNotice | null;
}

interface MagicBlockRuntimeContextValue {
  state: MagicBlockRuntimeState;
  connectionEndpoint: string;
  privateConnectionEndpoint: string | null;
  privateRpcUrl: string;
  sessionError: string | null;
  sessionLoading: boolean;
  sessionSigner: string | null;
  sessionTargetAddress: string | null;
  sessionTargetError: string | null;
  sessionToken: string | null;
  signMessageAvailable: boolean;
  walletAddress: string | null;
  walletConnected: boolean;
  actions: {
    createSession: () => Promise<void>;
    issueAuthToken: () => Promise<void>;
    revokeSession: () => Promise<void>;
    verifyPrivateRpc: () => Promise<void>;
  };
}

const defaultNotice: RuntimeNotice = {
  tone: "info",
  message:
    "No env is needed for the first two checks. Connect a wallet, verify the TEE RPC, then issue a PER auth token.",
};

const initialRuntimeState: MagicBlockRuntimeState = {
  integrityVerified: null,
  integrityCheckedAt: null,
  authToken: null,
  authExpiresAt: null,
  busyAction: null,
  error: null,
  notice: defaultNotice,
};

const MagicBlockRuntimeContext = createContext<MagicBlockRuntimeContextValue | null>(null);

export function MagicBlockRuntimeProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();

  if (!anchorWallet) {
    return (
      <MagicBlockRuntimeBaseProvider connection={connection} sessionWallet={null}>
        {children}
      </MagicBlockRuntimeBaseProvider>
    );
  }

  return (
    <SessionBackedMagicBlockRuntimeProvider anchorWallet={anchorWallet} connection={connection}>
      {children}
    </SessionBackedMagicBlockRuntimeProvider>
  );
}

export function useMagicBlockRuntime() {
  const context = useContext(MagicBlockRuntimeContext);

  if (context === null) {
    throw new Error("useMagicBlockRuntime must be used within MagicBlockRuntimeProvider.");
  }

  return context;
}

function SessionBackedMagicBlockRuntimeProvider({
  anchorWallet,
  children,
  connection,
}: {
  anchorWallet: AnchorWallet;
  children: ReactNode;
  connection: Connection;
}) {
  const sessionWallet = useSessionKeyManager(
    anchorWallet,
    connection,
    MAGICBLOCK_SOLANA_CLUSTER,
  );

  return (
    <SessionWalletProvider sessionWallet={sessionWallet}>
      <MagicBlockRuntimeBaseProvider connection={connection} sessionWallet={sessionWallet}>
        {children}
      </MagicBlockRuntimeBaseProvider>
    </SessionWalletProvider>
  );
}

function MagicBlockRuntimeBaseProvider({
  children,
  connection,
  sessionWallet,
}: {
  children: ReactNode;
  connection: Connection;
  sessionWallet: SessionWalletInterface | null;
}) {
  const wallet = useWallet();
  const [runtime, setRuntime] = useState<MagicBlockRuntimeState>(initialRuntimeState);
  const sessionTarget = useMemo(() => resolveSessionTargetProgram(), []);
  const lastWalletAddressRef = useRef<string | null>(null);

  const walletAddress = wallet.publicKey?.toBase58() ?? null;
  const privateConnectionEndpoint =
    runtime.authToken === null
      ? null
      : createPrivateConnection(runtime.authToken, MAGICBLOCK_PRIVATE_RPC_URL).rpcEndpoint;

  useEffect(() => {
    if (lastWalletAddressRef.current === walletAddress) {
      return;
    }

    lastWalletAddressRef.current = walletAddress;
    setRuntime((previous) => ({
      ...previous,
      authToken: null,
      authExpiresAt: null,
      error: null,
      notice:
        walletAddress === null
          ? defaultNotice
          : {
              tone: "info",
              message:
                "Wallet connected. Verify the TEE RPC, then issue a PER auth token for this wallet.",
            },
    }));
  }, [walletAddress]);

  async function handleVerifyPrivateRpc() {
    setRuntime((previous) => ({
      ...previous,
      busyAction: "verify",
      error: null,
      notice: {
        tone: "info",
        message: "Checking the MagicBlock TEE endpoint integrity...",
      },
    }));

    try {
      const integrityVerified = await verifyPrivateRpc(MAGICBLOCK_PRIVATE_RPC_URL);
      setRuntime((previous) => ({
        ...previous,
        busyAction: null,
        integrityVerified,
        integrityCheckedAt: Date.now(),
        notice: integrityVerified
          ? {
              tone: "success",
              message:
                "TEE RPC verification passed. The endpoint responded with a valid attestation quote.",
            }
          : {
              tone: "warning",
              message:
                "TEE RPC verification completed but did not return a valid integrity result.",
            },
      }));
    } catch (error) {
      setRuntime((previous) => ({
        ...previous,
        busyAction: null,
        error: error instanceof Error ? error.message : "TEE verification failed.",
        notice: {
          tone: "error",
          message:
            error instanceof Error ? error.message : "TEE verification failed.",
        },
      }));
    }
  }

  async function handleIssueAuthToken() {
    if (!wallet.publicKey || !wallet.signMessage) {
      setRuntime((previous) => ({
        ...previous,
        error: "Connected wallet must support signMessage to request a PER auth token.",
        notice: {
          tone: "warning",
          message:
            "This wallet cannot sign messages, so PER auth token issuance is unavailable.",
        },
      }));
      return;
    }

    setRuntime((previous) => ({
      ...previous,
      busyAction: "auth",
      error: null,
      notice: {
        tone: "info",
        message: "Requesting a PER auth token from the private RPC...",
      },
    }));

    try {
      const { token, expiresAt } = await requestPrivateAuthToken(
        {
          publicKey: wallet.publicKey,
          signMessage: wallet.signMessage,
        },
        MAGICBLOCK_PRIVATE_RPC_URL,
      );
      setRuntime((previous) => ({
        ...previous,
        busyAction: null,
        authToken: token,
        authExpiresAt: expiresAt,
        notice: {
          tone: "success",
          message:
            "PER auth token issued successfully. You can now use the private RPC connection.",
        },
      }));
    } catch (error) {
      setRuntime((previous) => ({
        ...previous,
        busyAction: null,
        error: error instanceof Error ? error.message : "Auth token request failed.",
        notice: {
          tone: "error",
          message:
            error instanceof Error ? error.message : "Auth token request failed.",
        },
      }));
    }
  }

  async function handleCreateSession() {
    if (sessionWallet === null || sessionTarget.publicKey === null) {
      setRuntime((previous) => ({
        ...previous,
        error: sessionTarget.error ?? "Session wallet is not available.",
        notice: {
          tone: "warning",
          message:
            sessionTarget.error ?? "Session wallet is not available for the connected wallet.",
        },
      }));
      return;
    }

    setRuntime((previous) => ({
      ...previous,
      busyAction: "createSession",
      error: null,
      notice: {
        tone: "info",
        message: "Creating a session key for the configured target program...",
      },
    }));

    try {
      await createSessionForProgram(sessionWallet, sessionTarget.publicKey);
      setRuntime((previous) => ({
        ...previous,
        busyAction: null,
        notice: {
          tone: "success",
          message:
            "Session key created. The runtime can now use delegated signing for supported flows.",
        },
      }));
    } catch (error) {
      setRuntime((previous) => ({
        ...previous,
        busyAction: null,
        error: error instanceof Error ? error.message : "Session creation failed.",
        notice: {
          tone: "error",
          message:
            error instanceof Error ? error.message : "Session creation failed.",
        },
      }));
    }
  }

  async function handleRevokeSession() {
    if (sessionWallet === null) {
      setRuntime((previous) => ({
        ...previous,
        error: "Session wallet is not available for the connected wallet.",
        notice: {
          tone: "warning",
          message: "Session wallet is not available for the connected wallet.",
        },
      }));
      return;
    }

    setRuntime((previous) => ({
      ...previous,
      busyAction: "revokeSession",
      error: null,
      notice: {
        tone: "info",
        message: "Revoking the active session key...",
      },
    }));

    try {
      await sessionWallet.revokeSession();
      setRuntime((previous) => ({
        ...previous,
        busyAction: null,
        notice: {
          tone: "success",
          message: "Session key revoked successfully.",
        },
      }));
    } catch (error) {
      setRuntime((previous) => ({
        ...previous,
        busyAction: null,
        error: error instanceof Error ? error.message : "Session revoke failed.",
        notice: {
          tone: "error",
          message:
            error instanceof Error ? error.message : "Session revoke failed.",
        },
      }));
    }
  }

  const value: MagicBlockRuntimeContextValue = {
    state: runtime,
    connectionEndpoint: connection.rpcEndpoint,
    privateConnectionEndpoint,
    privateRpcUrl: MAGICBLOCK_PRIVATE_RPC_URL,
    sessionError: sessionWallet?.error ?? null,
    sessionLoading: Boolean(sessionWallet?.isLoading),
    sessionSigner: sessionWallet?.publicKey?.toBase58() ?? null,
    sessionTargetAddress: sessionTarget.publicKey?.toBase58() ?? null,
    sessionTargetError: sessionTarget.error,
    sessionToken: sessionWallet?.sessionToken ?? null,
    signMessageAvailable: Boolean(wallet.signMessage),
    walletAddress,
    walletConnected: wallet.connected,
    actions: {
      createSession: handleCreateSession,
      issueAuthToken: handleIssueAuthToken,
      revokeSession: handleRevokeSession,
      verifyPrivateRpc: handleVerifyPrivateRpc,
    },
  };

  return (
    <MagicBlockRuntimeContext.Provider value={value}>
      {children}
    </MagicBlockRuntimeContext.Provider>
  );
}
