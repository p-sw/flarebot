import { createServer, type Server, type Socket } from "node:net";
import { SMTP_PORTS } from "./smtp-ports";

type Mode = keyof typeof SMTP_PORTS;

function reply(socket: Socket, line: string) {
  socket.write(`${line}\r\n`);
}

function ehlo(socket: Socket, mode: Mode) {
  const lines = ["250-mock.smtp"];
  if (mode === "starttls") lines.push("250-STARTTLS");
  lines.push("250-AUTH PLAIN LOGIN");
  lines.push("250 OK");
  socket.write(`${lines.join("\r\n")}\r\n`);
}

function handle(mode: Mode, socket: Socket) {
  if (mode === "hang" || mode === "implicitTls") return;
  reply(socket, "220 mock.smtp ESMTP");
  let buffer = "";
  let data = false;
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (data) {
        if (line === ".") {
          data = false;
          reply(socket, "250 queued");
        }
        continue;
      }
      const upper = line.toUpperCase();
      if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
        ehlo(socket, mode);
      } else if (upper.startsWith("STARTTLS")) {
        reply(socket, "454 4.7.0 TLS not available");
      } else if (upper.startsWith("AUTH")) {
        if (mode === "authFail") {
          reply(socket, "535 5.7.8 Authentication failed");
        } else if (mode === "ok") {
          const token = line.slice("AUTH PLAIN ".length).trim();
          const decoded = Buffer.from(token, "base64").toString("utf8");
          const password = decoded.split("\0")[2] ?? "";
          reply(
            socket,
            upper.startsWith("AUTH PLAIN ") && password === "secret"
              ? "235 authenticated"
              : "535 5.7.8 Authentication failed",
          );
        } else reply(socket, "235 authenticated");
      } else if (upper.startsWith("MAIL FROM")) {
        if (mode === "mailboxFail")
          reply(socket, "550 5.1.1 mailbox unavailable");
        else if (mode === "transient")
          reply(socket, "421 4.4.2 try again later");
        else reply(socket, "250 OK");
      } else if (upper.startsWith("RCPT TO")) {
        reply(socket, "250 OK");
      } else if (upper === "DATA") {
        data = true;
        reply(socket, "354 send the body");
      } else if (upper === "RSET") {
        reply(socket, "250 OK");
      } else if (upper === "QUIT") {
        reply(socket, "221 bye");
        socket.end();
      } else if (line.length > 0) {
        reply(socket, "250 OK");
      }
    }
  });
}

export async function startSmtpMocks(): Promise<Server[]> {
  const servers: Server[] = [];
  for (const [mode, port] of Object.entries(SMTP_PORTS) as [Mode, number][]) {
    const server = createServer((socket) => {
      socket.on("error", () => {});
      socket.setTimeout(5_000, () => socket.destroy());
      handle(mode, socket);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.removeAllListeners("error");
        server.on("error", () => {});
        resolve();
      });
    });
    servers.push(server);
  }
  return servers;
}

export async function stopSmtpMocks(servers: Server[]): Promise<void> {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
}
