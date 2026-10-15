import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { loadNativeSession } from "./lib/nativeSession";

// Registers listeners only; must run before the first lazy route is imported.
import "./lib/chunkReload";
// Native-app-only listeners (Android back button); nothing on the web.
import "./lib/nativeShell";

// In the native app the saved session token must be in memory before the
// first request (/auth/me on mount); on the web this resolves immediately.
loadNativeSession().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
