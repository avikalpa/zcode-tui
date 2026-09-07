// Zero-dep NDJSON client for the ZCode v4 protocol.
// Spawns the packaged runtime as a protocol server:
//   ELECTRON_RUN_AS_NODE=1 /opt/ZCode/zcode resources/glm/zcode.cjs app-server
// (launch decision measured in zcode.cjs: argv containing "app-server" or
// "agent-server" => protocol server presentation).
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";

export const ELECTRON_BIN = "/opt/ZCode/zcode";
export const RUNTIME_CJS = "/opt/ZCode/resources/glm/zcode.cjs";

export interface AppServerOptions {
  electronBin?: string;
  runtimeCjs?: string;
  env?: Record<string, string>;
  onStderr?: (chunk: string) => void;
  onExit?: (code: number | null) => void;
}

export class AppServer {
  proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: NodeJS.Timeout }
  >();
  private buffer = "";
  private pushListeners: ((msg: Record<string, unknown>) => void)[] = [];
  private askListeners: ((msg: Record<string, unknown>) => unknown)[] = [];
  private backendLostListeners: (() => void)[] = [];
  private opts: AppServerOptions;

  /** Register a listener for server pushes (no-id notifications). */
  onPush(cb: (msg: Record<string, unknown>) => void) {
    this.pushListeners.push(cb);
  }

  /** Register a handler for server→client requests (asks). The handler's
   * return value (or resolved promise) is sent back as the response. */
  onAsk(cb: (msg: Record<string, unknown>) => unknown) {
    this.askListeners.push(cb);
  }

  /** Test hook: feed a message through the push listeners. */
  emitPush(msg: Record<string, unknown>) {
    for (const cb of this.pushListeners) cb(msg);
  }

  constructor(
    readonly handlers: {
      onNotification?: (msg: Record<string, unknown>) => void;
      onServerRequest?: (msg: Record<string, unknown>) => void;
      onResponse?: (msg: Record<string, unknown>) => void;
    } = {},
    opts: AppServerOptions = {},
  ) {
    this.opts = opts;
    this.proc = this.#spawn();
  }

  #spawn(): ChildProcess {
    const bin = this.opts.electronBin ?? ELECTRON_BIN;
    const cjs = this.opts.runtimeCjs ?? RUNTIME_CJS;
    const proc = spawn(bin, [cjs, "app-server"], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_NO_WARNINGS: "1",
        ...this.opts.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    proc.on("exit", (code) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(`app-server exited (${code})`));
      }
      this.pending.clear();
      if (!this.closing) {
        for (const cb of this.backendLostListeners) cb();
        this.opts.onExit?.(code);
      }
    });
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (c: string) => this.opts.onStderr?.(c));
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (c: string) => this.#ingest(c));
    return proc;
  }

  /** Register a callback fired when the backend dies unexpectedly. */
  onBackendLost(cb: () => void) {
    this.backendLostListeners.push(cb);
  }

  /** Restart the backend after a loss; in-flight requests are rejected. */
  respawn() {
    if (this.proc.exitCode === null) this.proc.kill();
    this.buffer = "";
    this.proc = this.#spawn();
  }

  private closing = false;

  #ingest(chunk: string) {
    this.buffer += chunk;
    for (;;) {
      const nl = this.buffer.indexOf("\n");
      if (nl < 0) break;
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line.startsWith("{")) {
        if (line) this.handlers.onResponse?.({ __nonjson: line });
        continue;
      }
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        this.handlers.onResponse?.({ __unparseable: line });
        continue;
      }
      if (msg.method !== undefined && msg.id !== undefined) {
        // server→client request (ids look like "server-<n>")
        this.handlers.onServerRequest?.(msg);
        for (const cb of this.askListeners) {
          Promise.resolve(cb(msg))
            .then((result) => this.respond(msg.id as string, result ?? {}))
            .catch(() => this.respond(msg.id as string, {}));
        }
        continue;
      }
      const id = msg.id !== undefined ? String(msg.id) : undefined;
      if (id && this.pending.has(id)) {
        const p = this.pending.get(id)!;
        this.pending.delete(id);
        clearTimeout(p.timer);
        if (msg.error) {
          const err = msg.error as { code?: unknown; message?: unknown; data?: unknown };
          p.reject(Object.assign(new Error(String(err.message ?? "error")), { code: err.code, data: err.data }));
        } else p.resolve(msg.result ?? {});
      } else if (msg.method !== undefined) {
        this.handlers.onNotification?.(msg);
        for (const cb of this.pushListeners) cb(msg);
      } else {
        this.handlers.onResponse?.(msg);
      }
    }
  }

  request(method: string, params: unknown, timeoutMs = 8000): Promise<unknown> {
    const id = this.nextId++;
    const frame = JSON.stringify({ method, params, id }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`timeout (${timeoutMs}) waiting for response to ${method} id=${id}`));
      }, timeoutMs);
      this.pending.set(String(id), { resolve, reject, timer });
      this.proc.stdin!.write(frame);
    });
  }

  respond(id: number | string, result: unknown) {
    this.proc.stdin!.write(JSON.stringify({ id, result }) + "\n");
  }

  async close() {
    this.closing = true;
    if (this.proc.exitCode !== null) return;
    this.proc.stdin?.end();
    this.proc.kill();
    await Promise.race([once(this.proc, "exit"), new Promise((r) => setTimeout(r, 3000))]);
  }
}
