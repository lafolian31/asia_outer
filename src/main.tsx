import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
try {
  const saved = localStorage.getItem("farm-text-size");
  if (saved && ["small", "normal", "large", "extra"].includes(saved))
    document.documentElement.dataset.textSize = saved;
} catch {
  /* Use the readable default if browser storage is unavailable. */
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
