import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { logStartupEvent } from "./lib/tauri";
import "./index.css";

if (import.meta.env.MODE === "demo") await import("./demo/bootstrap");
const { i18nReady } = await import("./i18n");
await i18nReady;
const { default: App } = await import("./App");
logStartupEvent("i18n_ready", performance.now()).catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
logStartupEvent("root_rendered", performance.now()).catch(() => {});
