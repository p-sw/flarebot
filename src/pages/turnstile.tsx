// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
        },
      ) => string;
      reset?: (widgetId: string) => void;
      remove?: (widgetId: string) => void;
    };
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(new Error("turnstile"));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

/**
 * Renders the Turnstile widget and reports its token. A token works once, so
 * the caller bumps `attempt` after a failed submit to get a fresh one.
 */
export function TurnstileWidget({
  siteKey,
  onToken,
  attempt = 0,
  className,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  attempt?: number;
  className?: string;
}) {
  // State, not a ref: inside a dialog portal the node mounts one render late,
  // and the effect has to run again once it exists.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const widgetId = useRef("");
  const report = useRef(onToken);
  report.current = onToken;

  useEffect(() => {
    if (!node) return;
    let cancelled = false;
    void loadTurnstile()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        widgetId.current = window.turnstile.render(node, {
          sitekey: siteKey,
          callback: (token) => report.current(token),
          "expired-callback": () => report.current(""),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove?.(widgetId.current);
      widgetId.current = "";
      // The token belonged to the widget that is going away.
      report.current("");
    };
  }, [node, siteKey]);

  useEffect(() => {
    if (attempt === 0 || !widgetId.current) return;
    report.current("");
    window.turnstile?.reset?.(widgetId.current);
  }, [attempt]);

  return <div ref={setNode} className={className} />;
}
