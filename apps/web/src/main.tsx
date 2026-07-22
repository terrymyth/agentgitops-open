import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import { ActorProvider } from "./actor.js";
import { I18nProvider } from "./i18n.js";
import "./globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <ActorProvider>
        <App />
      </ActorProvider>
    </I18nProvider>
  </React.StrictMode>,
);
