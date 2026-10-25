import type { Server } from "node:net";
import { startSmtpMocks, stopSmtpMocks } from "./smtp-mock";

let servers: Server[] = [];

export async function setup(): Promise<void> {
  // Vite formats socket errors through a source map that is not a string, which
  // aborts the run. Keep the original message when that formatter throws.
  const prepare = Error.prepareStackTrace;
  Error.prepareStackTrace = (error, stack) => {
    try {
      return prepare ? prepare(error, stack) : String(error);
    } catch {
      return error instanceof Error ? error.message : String(error);
    }
  };
  servers = await startSmtpMocks();
}

export async function teardown(): Promise<void> {
  await stopSmtpMocks(servers);
}
