import "./style/app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { bootPwa } from "./lib/pwa";

bootPwa({ registerWorker: import.meta.env.PROD });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
