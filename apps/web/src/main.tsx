import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles/tokens.css";
import "./styles/fonts.css";
import "./styles/costume.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);