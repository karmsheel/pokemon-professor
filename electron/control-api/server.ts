import http from "http";
import type { ControlContext } from "./context";
import { handleRequest } from "./routes";

export interface ServerOptions {
  host?: string;
  port?: number;
}

export async function createControlServer(
  ctx: ControlContext,
  opts: ServerOptions = {}
): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 7946;

  const server = http.createServer((req, res) => {
    void handleRequest(ctx, req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on("error", reject);
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("failed to bind control server");
  }

  return {
    url: `http://${host}:${addr.port}`,
    port: addr.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
