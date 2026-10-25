// SPDX-License-Identifier: MIT

import { connect } from "cloudflare:sockets";
import { isBlockedHost, type MonitorType } from "../../shared/schemas";
import type { CheckOutcome } from "../scheduler/state-machine";
import {
  classifyFetchError,
  evaluateHeartbeat,
  evaluateHttp,
  failure,
  internalFailure,
  success,
} from "./evaluate";

const BODY_LIMIT = 65_536;

export async function runCheck(input: {
  type: MonitorType;
  config: unknown;
  timeoutMs: number;
  intervalMs: number;
  lastPushAt: number | null;
  now: number;
}): Promise<CheckOutcome> {
  try {
    switch (input.type) {
      case "http":
        return await runHttp(input.config as HttpConfig, input.timeoutMs);
      case "tcp":
        return await runTcp(
          input.config as { host: string; port: number },
          input.timeoutMs,
        );
      case "dns":
        return await runDns(input.config as DnsConfig, input.timeoutMs);
      case "ssl":
        return await runSsl(
          input.config as { host: string; warnDays: number },
          input.timeoutMs,
        );
      case "heartbeat":
        return evaluateHeartbeat(
          input.lastPushAt,
          input.intervalMs,
          ((input.config as { graceSeconds?: number }).graceSeconds ?? 0) *
            1000,
          input.now,
        );
    }
  } catch (error) {
    return internalFailure(
      error instanceof Error ? error.message.slice(0, 300) : "Check failed",
    );
  }
}

type HttpConfig = {
  url: string;
  method: string;
  headers?: { name: string; value: string }[];
  body?: string;
  followRedirects: boolean;
  expectedStatuses: number[];
  keyword?: string;
  keywordMode?: "present" | "absent";
  jsonPath?: string;
  jsonExpect?: string;
};

async function runHttp(
  config: HttpConfig,
  timeoutMs: number,
): Promise<CheckOutcome> {
  const started = Date.now();
  const headers = new Headers();
  for (const header of config.headers ?? [])
    headers.set(header.name, header.value);
  try {
    const response = await fetch(config.url, {
      method: config.method,
      headers,
      body:
        config.method === "GET" || config.method === "HEAD"
          ? undefined
          : config.body,
      redirect: config.followRedirects ? "follow" : "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (size < BODY_LIMIT) {
        const step = await reader.read();
        if (step.done) break;
        size += step.value.byteLength;
        chunks.push(step.value);
      }
      await reader.cancel();
    }
    const body = new TextDecoder().decode(concat(chunks).slice(0, BODY_LIMIT));
    return evaluateHttp({
      status: response.status,
      body,
      responseMs: Date.now() - started,
      expectedStatuses: config.expectedStatuses,
      keyword: config.keyword,
      keywordMode: config.keywordMode,
      jsonPath: config.jsonPath,
      jsonExpect: config.jsonExpect,
    });
  } catch (error) {
    return classifyFetchError(error);
  }
}

async function runTcp(
  config: { host: string; port: number },
  timeoutMs: number,
): Promise<CheckOutcome> {
  if (config.port === 25 || isBlockedHost(config.host)) {
    return failure(
      "connect",
      "That host or port cannot be dialed from Workers",
    );
  }
  const started = Date.now();
  let socket: ReturnType<typeof connect> | undefined;
  try {
    socket = connect({ hostname: config.host, port: config.port });
    await Promise.race([
      socket.opened,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timed out")), timeoutMs),
      ),
    ]);
    return success(Date.now() - started);
  } catch (error) {
    return classifyFetchError(error);
  } finally {
    try {
      socket?.close();
    } catch {
      // The socket may already be closed.
    }
  }
}

type DnsConfig = {
  name: string;
  type: string;
  expected: string[];
  resolver?: string;
};

async function runDns(
  config: DnsConfig,
  timeoutMs: number,
): Promise<CheckOutcome> {
  const started = Date.now();
  const endpoint = new URL(
    config.resolver || "https://cloudflare-dns.com/dns-query",
  );
  endpoint.searchParams.set("name", config.name);
  endpoint.searchParams.set("type", config.type);
  try {
    const response = await fetch(endpoint, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok)
      return failure(
        "dns",
        `Resolver returned ${response.status}`,
        Date.now() - started,
      );
    const payload = (await response.json()) as {
      Status?: number;
      Answer?: { data?: string }[];
    };
    if (payload.Status !== 0)
      return failure(
        "dns",
        `DNS status ${payload.Status}`,
        Date.now() - started,
      );
    const actual = new Set(
      (payload.Answer ?? []).map((answer) => normalizeDns(answer.data ?? "")),
    );
    const expected = config.expected.map(normalizeDns);
    const missing = expected.filter((value) => !actual.has(value));
    if (missing.length > 0) {
      return failure(
        "dns",
        `Missing ${missing.join(", ")}`,
        Date.now() - started,
      );
    }
    return success(Date.now() - started);
  } catch (error) {
    return classifyFetchError(error);
  }
}

function normalizeDns(value: string): string {
  return value.trim().toLowerCase().replace(/^"|"$/g, "").replace(/\.$/, "");
}

async function runSsl(
  config: { host: string; warnDays: number },
  timeoutMs: number,
): Promise<CheckOutcome> {
  const started = Date.now();
  try {
    const response = await fetch(
      `https://crt.sh/?q=${encodeURIComponent(config.host)}&output=json`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(Math.min(timeoutMs, 8000)),
      },
    );
    if (!response.ok)
      return await sslFallback(
        config.host,
        timeoutMs,
        started,
        `CT log returned ${response.status}`,
      );
    const text = await response.text();
    if (text.length > 1_000_000)
      return internalFailure(
        "CT log response was too large to estimate expiry",
      );
    const rows = JSON.parse(text) as {
      name_value?: string;
      not_after?: string;
    }[];
    let latest = 0;
    for (const row of rows) {
      if (
        !row.not_after ||
        !row.name_value ||
        !coversHost(row.name_value, config.host)
      )
        continue;
      const stamp = Date.parse(`${row.not_after.replace(" ", "T")}Z`);
      if (Number.isFinite(stamp) && stamp > latest) latest = stamp;
    }
    if (!latest)
      return internalFailure("No matching certificate in CT logs yet");
    const days = Math.floor((latest - Date.now()) / 86_400_000);
    const outcome =
      days < 0
        ? failure(
            "tls",
            "Certificate appears expired in CT logs",
            Date.now() - started,
          )
        : days < config.warnDays
          ? failure(
              "tls",
              `Certificate estimate expires in ${days} days`,
              Date.now() - started,
            )
          : success(Date.now() - started);
    outcome.certNotAfter = latest;
    return outcome;
  } catch (error) {
    return sslFallback(
      config.host,
      timeoutMs,
      started,
      error instanceof Error ? error.message : "CT log failed",
    );
  }
}

async function sslFallback(
  host: string,
  timeoutMs: number,
  _started: number,
  reason: string,
): Promise<CheckOutcome> {
  try {
    const response = await fetch(`https://${host}`, {
      method: "HEAD",
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    return internalFailure(
      `Certificate expiry could not be estimated (${reason.slice(0, 120)})`,
    );
  } catch (error) {
    const classified = classifyFetchError(error);
    if (classified.errorKind === "tls") return classified;
    return internalFailure(reason.slice(0, 300));
  }
}

function coversHost(nameValue: string, host: string): boolean {
  const target = host.trim().toLowerCase();
  return nameValue.split(/\n+/).some((raw) => {
    const name = raw.trim().toLowerCase();
    if (name.startsWith("*."))
      return target.endsWith(name.slice(1)) && target !== name.slice(2);
    return target === name;
  });
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
