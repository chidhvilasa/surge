import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SurgeGame } from "../../frontend/src/components/surge/SurgeGame";
import "../../frontend/src/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Surge extension: #root element not found");

createRoot(root).render(
  <StrictMode>
    <SurgeGame />
  </StrictMode>,
);
