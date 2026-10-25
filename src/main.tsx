// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionRoot } from "./motion/page";
import { queryClient, router } from "./router";
import "./styles/theme.css";

const stored = localStorage.getItem("theme");
if (stored === "dark") document.documentElement.classList.add("dark");

const root = document.getElementById("root");
if (!root) throw new Error("Missing root");

createRoot(root).render(
  <StrictMode>
    <MotionRoot>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MotionRoot>
  </StrictMode>,
);
