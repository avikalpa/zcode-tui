import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface IdleLockRecord {
  token: string; pid: number; boot_id: string; acquired_at: number; renewed_at: number;
}
export interface IdleLockProbe {
  now: () => number;
  bootId: () => string;
  pidDead: (pid: number) => boolean;
}
const systemProbe: IdleLockProbe = {
  now: Date.now,
  bootId: () => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
  pidDead: (pid) => {
    try { statSync(`/proc/${pid}`); return false; }
    catch (e) { return (e as NodeJS.ErrnoException).code === "ENOENT"; }
  },
};
const THREE_HOURS = 3 * 3600_000;

/** All record compare/mutations serialize under mkdir. An interrupted guard
 * holds closed: no age-based guard removal and no recursive lock deletion. */
export class IdleExecLock {
  readonly path: string;
  private owned: IdleLockRecord | null = null;
  constructor(root: string, private probe = systemProbe, private staleMs = 180_000) {
    this.path = join(root, "ztq-idle-exec");
  }
  private guarded(action: () => boolean): boolean {
    let guarded = false;
    try {
      // A missing shared plane is not a new local plane to manufacture.
      if (!statSync(join(this.path, "..")).isDirectory()) return false;
      try { mkdirSync(this.path); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      mkdirSync(join(this.path, ".guard"));
      guarded = true;
      return action();
    } catch { return false; }
    finally { if (guarded) { try { rmdirSync(join(this.path, ".guard")); } catch { /* hold closed */ } } }
  }
  private read(): IdleLockRecord | null {
    try {
      const r = JSON.parse(readFileSync(join(this.path, "owner.json"), "utf8"));
      if (typeof r.token !== "string" || !r.token || !Number.isSafeInteger(r.pid) || r.pid <= 0
        || typeof r.boot_id !== "string" || !r.boot_id || !Number.isFinite(r.acquired_at)
        || !Number.isFinite(r.renewed_at) || r.renewed_at < r.acquired_at) throw new Error("invalid owner");
      return r;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  private write(r: IdleLockRecord): void {
    const tmp = join(this.path, `.${r.token}.tmp`);
    try {
      writeFileSync(tmp, JSON.stringify(r) + "\n", { flag: "wx", mode: 0o600 });
      renameSync(tmp, join(this.path, "owner.json"));
    } finally { try { unlinkSync(tmp); } catch { /* already renamed */ } }
  }
  acquire(): boolean {
    return this.guarded(() => {
      const boot = this.probe.bootId();
      if (!boot) return false;
      const now = this.probe.now(), prior = this.read();
      if (prior) {
        if (this.owned) return false;
        if (now - prior.renewed_at <= this.staleMs || now - prior.acquired_at <= THREE_HOURS
          || prior.boot_id !== boot || !this.probe.pidDead(prior.pid)) return false;
      } else {
        // Legacy/partial locks have no provable owner. Never erase them.
        try { statSync(join(this.path, "stamp.txt")); return false; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      }
      const record = { token: randomUUID(), pid: process.pid, boot_id: boot, acquired_at: now, renewed_at: now };
      this.write(record);
      this.owned = record;
      return true;
    });
  }
  renew(): boolean {
    return this.guarded(() => {
      if (!this.owned || this.read()?.token !== this.owned.token) return false;
      const record = { ...this.owned, renewed_at: this.probe.now() };
      this.write(record);
      this.owned = record;
      return true;
    });
  }
  release(): boolean {
    return this.guarded(() => {
      if (!this.owned || this.read()?.token !== this.owned.token) return false;
      unlinkSync(join(this.path, "owner.json"));
      this.owned = null;
      return true;
    });
  }
}
