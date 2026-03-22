import { useMemo, useState } from "react";
import {
  useAnchorWallet,
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  SessionWalletProvider,
  SessionWalletInterface,
  useSessionKeyManager,
} from "@magicblock-labs/gum-react-sdk";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import type { Connection } from "@solana/web3.js";
import {
  MAGICBLOCK_PRIVATE_RPC_URL,
  MAGICBLOCK_SOLANA_CLUSTER,
  MAGICBLOCK_SESSION_TARGET_PROGRAM_ID,
  MAGICBLOCK_SESSION_TOP_UP_LAMPORTS,
  MAGICBLOCK_SESSION_VALIDITY_MINUTES,
  createPrivateConnection,
  createSessionForProgram,
  formatExpiry,
  requestPrivateAuthToken,
  resolveSessionTargetProgram,
  shortenAddress,
  verifyPrivateRpc,
} from "../lib/magicblock";

type RuntimeBusyAction = "verify" | "auth" | "createSession" | "revokeSession" | null;

interface RuntimeState {
  integrityVerified: boolean | null;
  authToken: string | null;
  authExpiresAt: number | null;
  error: string | null;
}

const initialRuntimeState: RuntimeState = {
  integrityVerified: null,
  authToken: null,
  authExpiresAt: null,
  error: null,
};

export function WalletRuntimePanel() {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();

  if (!anchorWallet) {
    return <WalletRuntimePanelBase connection={connection} sessionWallet={null} />;
  }

  return (
    <SessionBackedWalletRuntimePanel
      anchorWallet={anchorWallet}
      connection={connection}
    />
  );
}

function SessionBackedWalletRuntimePanel({
  anchorWallet,
  connection,
}: {
  anchorWallet: AnchorWallet;
  connection: Connection;
}) {
  const sessionWallet = useSessionKeyManager(
    anchorWallet,
    connection,
    MAGICBLOCK_SOLANA_CLUSTER,
  );

  return (
    <SessionWalletProvider sessionWallet={sessionWallet}>
      <WalletRuntimePanelBase connection={connection} sessionWallet={sessionWallet} />
    </SessionWalletProvider>
  );
}

function WalletRuntimePanelBase({
  connection,
  sessionWallet,
}: {
  connection: Connection;
  sessionWallet: SessionWalletInterface | null;
}) {
  const wallet = useWallet();
  const [runtime, setRuntime] = useState<RuntimeState>(initialRuntimeState);
  const [busyAction, setBusyAction] = useState<RuntimeBusyAction>(null);

  const sessionTarget = useMemo(() => resolveSessionTargetProgram(), []);
  const privateConnection = useMemo(
    () =>
      runtime.authToken === null
        ? null
        : createPrivateConnection(runtime.authToken, MAGICBLOCK_PRIVATE_RPC_URL),
    [runtime.authToken],
  );

  async function handleVerify() {
    setBusyAction("verify");
    setRuntime((previous) => ({ ...previous, error: null }));

    try {
      const integrityVerified = await verifyPrivateRpc(MAGICBLOCK_PRIVATE_RPC_URL);
      setRuntime((previous) => ({
        ...previous,
        integrityVerified,
      }));
    } catch (error) {
      setRuntime((previous) => ({
        ...previous,
        error: error instanceof Error ? error.message : "TEE verification failed.",
      }));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleIssueAuthToken() {
    if (!wallet.publicKey || !wallet.signMessage) {
      setRuntime((previous) => ({
        ...previous,
        error: "Connected wallet must support signMessage to request a PER auth token.",
      }));
      return;
    }

    setBusyAction("auth");
    setRuntime((previous) => ({ ...previous, error: null }));

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
        authToken: token,
        authExpiresAt: expiresAt,
      }));
    } catch (error) {
      setRuntime((previous) => ({
        ...previous,
        error: error instanceof Error ? error.message : "Auth token request failed.",
      }));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateSession() {
    if (sessionWallet === null || sessionTarget.publicKey === null) {
      return;
    }

    setBusyAction("createSession");
    setRuntime((previous) => ({ ...previous, error: null }));

    try {
      await createSessionForProgram(sessionWallet, sessionTarget.publicKey);
    } catch (error) {
      setRuntime((previous) => ({
        ...previous,
        error: error instanceof Error ? error.message : "Session creation failed.",
      }));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRevokeSession() {
    if (sessionWallet === null) {
      return;
    }

    setBusyAction("revokeSession");
    setRuntime((previous) => ({ ...previous, error: null }));

    try {
      await sessionWallet.revokeSession();
    } catch (error) {
      setRuntime((previous) => ({
        ...previous,
        error: error instanceof Error ? error.message : "Session revoke failed.",
      }));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="section-label">Live wallet runtime</div>
          <h3>MagicBlock wiring</h3>
        </div>
        <span className={`status ${getRuntimeTone(runtime, sessionWallet)}`}>
          {getRuntimeLabel(runtime, sessionWallet)}
        </span>
      </div>

      <p className="panel-copy">
        This panel uses a real wallet connection, MagicBlock TEE verification,
        PER auth token requests, and Session Key lifecycle hooks.
      </p>

      <div className="wallet-button-row">
        <WalletMultiButton />
      </div>

      <dl className="settlement-grid compact runtime-grid">
        <div>
          <dt>Solana RPC</dt>
          <dd>{connection.rpcEndpoint}</dd>
        </div>
        <div>
          <dt>Private RPC</dt>
          <dd>{MAGICBLOCK_PRIVATE_RPC_URL}</dd>
        </div>
        <div>
          <dt>Wallet</dt>
          <dd>{shortenAddress(wallet.publicKey?.toBase58())}</dd>
        </div>
        <div>
          <dt>Sign message</dt>
          <dd>{wallet.signMessage ? "Available" : "Not available"}</dd>
        </div>
        <div>
          <dt>PER auth token</dt>
          <dd>{runtime.authToken ? shortenAddress(runtime.authToken) : "Not issued"}</dd>
        </div>
        <div>
          <dt>Token expiry</dt>
          <dd>{formatExpiry(runtime.authExpiresAt)}</dd>
        </div>
      </dl>

      <div className="button-row">
        <button
          className="primary-button"
          disabled={!wallet.connected || busyAction !== null}
          onClick={() => void handleVerify()}
          type="button"
        >
          {busyAction === "verify" ? "Verifying..." : "Verify TEE RPC"}
        </button>
        <button
          className="secondary-button"
          disabled={!wallet.connected || !wallet.signMessage || busyAction !== null}
          onClick={() => void handleIssueAuthToken()}
          type="button"
        >
          {busyAction === "auth" ? "Authorizing..." : "Issue PER auth token"}
        </button>
      </div>

      <div className="runtime-divider" />

      <div className="runtime-block">
        <div className="runtime-subheader">
          <strong>Session Keys</strong>
          <small>
            Target program:{" "}
            {sessionTarget.publicKey
              ? shortenAddress(sessionTarget.publicKey.toBase58())
              : "Not configured"}
          </small>
        </div>

        <dl className="settlement-grid compact runtime-grid">
          <div>
            <dt>Session signer</dt>
            <dd>{shortenAddress(sessionWallet?.publicKey?.toBase58())}</dd>
          </div>
          <div>
            <dt>Session token</dt>
            <dd>{shortenAddress(sessionWallet?.sessionToken)}</dd>
          </div>
          <div>
            <dt>Top-up lamports</dt>
            <dd>{MAGICBLOCK_SESSION_TOP_UP_LAMPORTS.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Validity</dt>
            <dd>{MAGICBLOCK_SESSION_VALIDITY_MINUTES} minutes</dd>
          </div>
        </dl>

        <div className="button-row">
          <button
            className="primary-button"
            disabled={
              !wallet.connected ||
              sessionWallet === null ||
              sessionTarget.publicKey === null ||
              busyAction !== null
            }
            onClick={() => void handleCreateSession()}
            type="button"
          >
            {busyAction === "createSession" || sessionWallet?.isLoading
              ? "Creating session..."
              : "Create session key"}
          </button>
          <button
            className="secondary-button"
            disabled={
              !wallet.connected ||
              sessionWallet === null ||
              !sessionWallet.sessionToken ||
              busyAction !== null
            }
            onClick={() => void handleRevokeSession()}
            type="button"
          >
            {busyAction === "revokeSession" ? "Revoking..." : "Revoke session"}
          </button>
        </div>

        <p className="panel-copy">
          {sessionTarget.error ??
            `Configured via VITE_SESSION_TARGET_PROGRAM_ID=${MAGICBLOCK_SESSION_TARGET_PROGRAM_ID}.`}
        </p>
      </div>

      {privateConnection ? (
        <p className="panel-copy">
          Private connection ready at <code>{privateConnection.rpcEndpoint}</code>
        </p>
      ) : null}

      {runtime.error || sessionWallet?.error ? (
        <p className="runtime-error">{runtime.error ?? sessionWallet?.error}</p>
      ) : null}
    </section>
  );
}

function getRuntimeTone(
  runtime: RuntimeState,
  sessionWallet: SessionWalletInterface | null,
): "ready" | "review" | "bidding" {
  if (runtime.authToken || sessionWallet?.sessionToken) {
    return "ready";
  }

  if (runtime.integrityVerified) {
    return "review";
  }

  return "bidding";
}

function getRuntimeLabel(
  runtime: RuntimeState,
  sessionWallet: SessionWalletInterface | null,
): string {
  if (runtime.authToken && sessionWallet?.sessionToken) {
    return "auth + session";
  }

  if (runtime.authToken) {
    return "auth ready";
  }

  if (sessionWallet?.sessionToken) {
    return "session ready";
  }

  if (runtime.integrityVerified) {
    return "tee verified";
  }

  return "wallet idle";
}
