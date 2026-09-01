import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@/components/app-shell";
import { GateProvider } from "@/lib/gate/context";
import "@/styles.css";

const el = document.getElementById("app");
if (!el) throw new Error("missing #app");

createRoot(el).render(
  <StrictMode>
    <GateProvider>
      <AppShell />
    </GateProvider>
  </StrictMode>,
);
