import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import "@solana/wallet-adapter-react-ui/styles.css";
import App from "./App";
import { AppProviders } from "./providers/AppProviders";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);
