import { hostname } from "node:os";

export class IdleHostBannedError extends Error {
  readonly code = "IDLE_HOST_BANNED";
  constructor() {
    super("IDLE_HOST_BANNED: jojo is the owner's laptop; idle execution is banned on jojo (owner 2026-10-27); use dev or another fleet server");
    this.name = "IdleHostBannedError";
  }
}

/** The override is a test seam only; production always uses the hostname. */
export function assertIdleHostAllowed(host = hostname(), env = process.env): void {
  const testClass = env.NODE_ENV === "test" ? env.ZCODE_TUI_IDLE_HOST_CLASS : undefined;
  const laptop = testClass === "laptop" || (testClass !== "server" && host.toLowerCase().startsWith("jojo"));
  if (laptop) throw new IdleHostBannedError();
}

export function assertIdleTargetAllowed(target: string): void {
  // Do not let an SSH user prefix or FQDN evade the negative host rule.
  const host = target.split("@").at(-1)!.toLowerCase();
  if (host.startsWith("jojo")) throw new IdleHostBannedError();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(host)) throw new Error("IDLE_TARGET_INVALID: expected a fleet server hostname");
}
