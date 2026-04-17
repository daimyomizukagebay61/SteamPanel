import { StrictMode, Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("React crash:", error, info);
  }
  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div style={{ padding: 32, fontFamily: "monospace", background: "#0f0f0f", color: "#f87171", minHeight: "100vh" }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>⚠ SteamPanel failed to start</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#fca5a5" }}>
            {(error as Error).message}
            {"\n\n"}
            {(error as Error).stack}
          </pre>
          <p style={{ marginTop: 16, color: "#9ca3af", fontSize: 12 }}>
            Open browser console (F12) for more details, or report this error.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
