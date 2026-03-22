import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  MAGICBLOCK_SESSION_TARGET_PROGRAM_ID,
  MAGICBLOCK_SESSION_TOP_UP_LAMPORTS,
  MAGICBLOCK_SESSION_VALIDITY_MINUTES,
  formatExpiry,
  shortenAddress,
} from "../lib/magicblock";
import {
  MagicBlockRuntimeState,
  RuntimeBusyAction,
  RuntimeNoticeTone,
  useMagicBlockRuntime,
} from "../providers/MagicBlockRuntimeProvider";

export function WalletRuntimePanel() {
  const runtime = useMagicBlockRuntime();
  const sessionStatusLabel = getRuntimeLabel(runtime.state, runtime.sessionToken);
  const sessionStatusTone = getRuntimeTone(runtime.state, runtime.sessionToken);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="section-label">Live wallet runtime</div>
          <h3>MagicBlock wiring</h3>
        </div>
        <span className={`status ${sessionStatusTone}`}>{sessionStatusLabel}</span>
      </div>

      <p className="panel-copy">
        This panel is the single runtime source of truth for wallet connection,
        MagicBlock TEE verification, PER auth token requests, and Session Key lifecycle hooks.
      </p>

      <div className={`runtime-notice ${runtime.state.notice?.tone ?? "info"}`}>
        <strong>{getNoticeTitle(runtime.state.notice?.tone ?? "info")}</strong>
        <p>{runtime.state.notice?.message ?? "Runtime ready."}</p>
      </div>

      <div className="wallet-button-row">
        <WalletMultiButton />
      </div>

      <dl className="settlement-grid compact runtime-grid">
        <div>
          <dt>Solana RPC</dt>
          <dd>{runtime.connectionEndpoint}</dd>
        </div>
        <div>
          <dt>Private RPC</dt>
          <dd>{runtime.privateRpcUrl}</dd>
        </div>
        <div>
          <dt>Wallet</dt>
          <dd>{shortenAddress(runtime.walletAddress)}</dd>
        </div>
        <div>
          <dt>TEE check</dt>
          <dd>{formatIntegrity(runtime.state.integrityVerified, runtime.state.integrityCheckedAt)}</dd>
        </div>
        <div>
          <dt>Sign message</dt>
          <dd>{runtime.signMessageAvailable ? "Available" : "Not available"}</dd>
        </div>
        <div>
          <dt>PER auth token</dt>
          <dd>{runtime.state.authToken ? shortenAddress(runtime.state.authToken) : "Not issued"}</dd>
        </div>
        <div>
          <dt>Token expiry</dt>
          <dd>{formatExpiry(runtime.state.authExpiresAt)}</dd>
        </div>
      </dl>

      <div className="button-row">
        <button
          className="primary-button"
          disabled={!runtime.walletConnected || runtime.state.busyAction !== null}
          onClick={() => void runtime.actions.verifyPrivateRpc()}
          type="button"
        >
          {getVerifyLabel(runtime.state.busyAction)}
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
          {getAuthLabel(runtime.state.busyAction)}
        </button>
      </div>

      <div className="runtime-divider" />

      <div className="runtime-block">
        <div className="runtime-subheader">
          <strong>What To Test</strong>
          <small>No env required for steps 1 and 2</small>
        </div>
        <ul className="checklist runtime-checklist">
          <li>Connect Phantom or Solflare and confirm the wallet address appears above.</li>
          <li>Click `Verify TEE RPC` and confirm `TEE check` changes to `Passed` with a timestamp.</li>
          <li>Click `Issue PER auth token` and confirm a token preview and expiry time appear.</li>
          <li>Switch back to `Deal Rooms` and confirm hidden terms unlock only after the live runtime is ready.</li>
          <li>Ignore `Create session key` until `VITE_SESSION_TARGET_PROGRAM_ID` is configured.</li>
        </ul>
      </div>

      <div className="runtime-divider" />

      <div className="runtime-block">
        <div className="runtime-subheader">
          <strong>Session Keys</strong>
          <small>
            Target program:{" "}
            {runtime.sessionTargetAddress
              ? shortenAddress(runtime.sessionTargetAddress)
              : "Not configured"}
          </small>
        </div>

        <dl className="settlement-grid compact runtime-grid">
          <div>
            <dt>Session signer</dt>
            <dd>{shortenAddress(runtime.sessionSigner)}</dd>
          </div>
          <div>
            <dt>Session token</dt>
            <dd>{shortenAddress(runtime.sessionToken)}</dd>
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
              !runtime.walletConnected ||
              runtime.sessionTargetAddress === null ||
              runtime.state.busyAction !== null
            }
            onClick={() => void runtime.actions.createSession()}
            type="button"
          >
            {getCreateSessionLabel(runtime.state.busyAction, runtime.sessionLoading)}
          </button>
          <button
            className="secondary-button"
            disabled={
              !runtime.walletConnected ||
              runtime.sessionToken === null ||
              runtime.state.busyAction !== null
            }
            onClick={() => void runtime.actions.revokeSession()}
            type="button"
          >
            {getRevokeSessionLabel(runtime.state.busyAction)}
          </button>
        </div>

        <p className="panel-copy">
          {runtime.sessionTargetError ??
            `Configured via VITE_SESSION_TARGET_PROGRAM_ID=${MAGICBLOCK_SESSION_TARGET_PROGRAM_ID}.`}
        </p>
      </div>

      {runtime.privateConnectionEndpoint ? (
        <p className="panel-copy">
          Private connection ready at <code>{runtime.privateConnectionEndpoint}</code>
        </p>
      ) : null}

      {runtime.state.error || runtime.sessionError ? (
        <p className="runtime-error">{runtime.state.error ?? runtime.sessionError}</p>
      ) : null}
    </section>
  );
}

function getRuntimeTone(
  runtime: MagicBlockRuntimeState,
  sessionToken: string | null,
): "ready" | "review" | "bidding" {
  if (runtime.authToken || sessionToken) {
    return "ready";
  }

  if (runtime.integrityVerified) {
    return "review";
  }

  return "bidding";
}

function getRuntimeLabel(runtime: MagicBlockRuntimeState, sessionToken: string | null): string {
  if (runtime.authToken && sessionToken) {
    return "auth + session";
  }

  if (runtime.authToken) {
    return "auth ready";
  }

  if (sessionToken) {
    return "session ready";
  }

  if (runtime.integrityVerified) {
    return "tee verified";
  }

  return "wallet idle";
}

function formatIntegrity(
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

function getNoticeTitle(tone: RuntimeNoticeTone): string {
  if (tone === "success") {
    return "Verification complete";
  }

  if (tone === "warning") {
    return "Check required";
  }

  if (tone === "error") {
    return "Action failed";
  }

  return "Next step";
}

function getVerifyLabel(busyAction: RuntimeBusyAction): string {
  return busyAction === "verify" ? "Verifying..." : "Verify TEE RPC";
}

function getAuthLabel(busyAction: RuntimeBusyAction): string {
  return busyAction === "auth" ? "Authorizing..." : "Issue PER auth token";
}

function getCreateSessionLabel(
  busyAction: RuntimeBusyAction,
  sessionLoading: boolean,
): string {
  return busyAction === "createSession" || sessionLoading
    ? "Creating session..."
    : "Create session key";
}

function getRevokeSessionLabel(busyAction: RuntimeBusyAction): string {
  return busyAction === "revokeSession" ? "Revoking..." : "Revoke session";
}
