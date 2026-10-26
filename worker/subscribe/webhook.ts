// SPDX-License-Identifier: MIT

import {
  isNonPublicHost,
  isNonPublicIp,
  signBody,
  webhookUrlIssue,
} from "../../shared/subscriptions";

type OutboundFetch = typeof fetch;

let outboundFetch: OutboundFetch = (input, init) => fetch(input, init);

/** Replaces outbound DNS and webhook fetches. Tests pass null to restore fetch. */
export function setOutboundFetch(next: OutboundFetch | null): void {
  outboundFetch = next ?? ((input, init) => fetch(input, init));
}

export async function screenWebhookUrl(
  raw: string,
  allowHttp: boolean,
): Promise<
  | { ok: true; href: string }
  | { ok: false; issue: "scheme" | "http" | "private" | "credentials" | "dns" }
> {
  const parsed = webhookUrlIssue(raw, allowHttp);
  if (!parsed.ok) return parsed;
  const verdict = await assertPublicDns(parsed.host);
  if (verdict !== "ok") return { ok: false, issue: verdict };
  return { ok: true, href: parsed.href };
}

export async function assertPublicDns(
  host: string,
): Promise<"ok" | "private" | "dns"> {
  if (isNonPublicHost(host)) return "private";
  if (isLiteralAddress(host)) return "ok";
  let ips: string[] = [];
  try {
    const [v4, v6] = await Promise.all([
      lookupDns(host, "A"),
      lookupDns(host, "AAAA"),
    ]);
    ips = [...v4, ...v6];
  } catch {
    return "dns";
  }
  if (ips.length === 0) return "dns";
  if (ips.some((ip) => isNonPublicIp(ip))) return "private";
  return "ok";
}

function isLiteralAddress(host: string): boolean {
  return isNonPublicIp(host) || ipv4Like(host) || host.includes(":");
}

function ipv4Like(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

async function lookupDns(name: string, type: "A" | "AAAA"): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  const response = await outboundFetch(url, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) return [];
  const data = (await response.json()) as {
    Status?: number;
    Answer?: { type?: number; data?: string }[];
  };
  if (data.Status !== 0) return [];
  const want = type === "A" ? 1 : 28;
  return (data.Answer ?? [])
    .filter((row) => row.type === want && typeof row.data === "string")
    .map((row) => (row.data ?? "").replace(/\.$/, ""));
}

export async function postSignedWebhook(
  url: string,
  secret: string,
  payload: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signBody(secret, timestamp, body);
  try {
    const response = await outboundFetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "user-agent": "Flarebot",
        "x-flarebot-timestamp": timestamp,
        "x-flarebot-signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(4000),
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, error: "redirect" };
    }
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, error: `status ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "network";
    return { ok: false, error: message.slice(0, 200) };
  }
}
