import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { I18nProvider } from "./i18n/I18n.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);

// Saves the case file for playing without internet, after the page has finished loading.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("/sw.js");
      const { active } = await navigator.serviceWorker.ready;
      if (!navigator.connection?.saveData) active.postMessage("save-case-file");
    } catch {
      // No offline copy on this device; the game still works online.
    }
  });
}
