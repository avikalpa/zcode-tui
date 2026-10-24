import { expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { createToastStore, Toast } from "./toast";
import { THEMES } from "./design";

function fixture() {
  let now = 0;
  let id = 0;
  const tasks = new Map<number, { at: number; run: () => void }>();
  const store = createToastStore({ now: () => now,
    set(run, delay) { tasks.set(++id, { at: now + delay, run }); return id; },
    clear(handle) { tasks.delete(handle as number); },
  });
  const advance = (ms: number) => {
    const end = now + ms;
    while (true) {
      const next = [...tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; tasks.delete(next[0]); next[1].run();
    }
    now = end;
  };
  return { store, advance, tasks };
}

test("hover preserves remaining time; queued notifications show in arrival order", () => {
  const { store, advance } = fixture();
  store.show({ message: "First", variant: "info", duration: 1000 });
  advance(400); store.pause();
  store.show({ message: "Second", variant: "success", duration: 500 });
  store.show({ message: "Third", variant: "warning", duration: 300 });
  advance(5000);
  expect(store.getSnapshot().currentToast?.message).toBe("First");
  expect(store.getSnapshot().pending).toBe(2);
  store.resume(); advance(599);
  expect(store.getSnapshot().currentToast?.message).toBe("First");
  advance(1); expect(store.getSnapshot().currentToast?.message).toBe("Second");
  advance(500); expect(store.getSnapshot().currentToast?.message).toBe("Third");
  advance(300); expect(store.getSnapshot().currentToast).toBeNull();
});

test("replacement restarts the reference five-second duration and cleanup cancels it", () => {
  const { store, advance, tasks } = fixture();
  store.show({ message: "First", variant: "info" }); advance(4900);
  store.show({ message: "Replacement", variant: "error" }); advance(100);
  expect(store.getSnapshot().currentToast?.message).toBe("Replacement");
  advance(4899); expect(store.getSnapshot().currentToast).not.toBeNull();
  advance(1); expect(store.getSnapshot().currentToast).toBeNull();
  store.show({ message: "Unmount", variant: "info" }); store.dispose();
  expect(tasks.size).toBe(0);
});

test("click affordance dismisses the rendered toast and invokes its action", async () => {
  let activated = 0;
  const setup = await testRender(<Toast C={THEMES.opencode} width={50}
    toast={{ title: "Fixture saved", message: "Review the change", variant: "success", action: { label: "open", run: () => {} } }}
    pending={2} onHover={() => {}} onActivate={() => { activated++; }} />, { width: 50, height: 15 });
  try {
    const frame = await setup.waitForFrame((f) => f.includes("› open"));
    expect(frame).toContain("Review the change"); expect(frame).toContain("+2 more"); expect(frame).toContain("┃");
    const lines = frame.split("\n"); const y = lines.findIndex((line) => line.includes("› open"));
    await act(async () => { await setup.mockMouse.click(lines[y].indexOf("› open") + 1, y); });
    expect(activated).toBe(1);
  } finally { setup.renderer.destroy(); }
});

test("dismiss while hovered keeps the next toast readable; actions run once", () => {
  const { store, advance } = fixture(); let runs = 0;
  store.show({ message: "First", variant: "info", action: { label: "Open", run: () => { runs++; } } });
  store.pause(); store.show({ message: "Second", variant: "info" });
  store.activate(); advance(6000);
  expect(runs).toBe(1); expect(store.getSnapshot().currentToast?.message).toBe("Second");
  store.resume(); advance(5000); expect(store.getSnapshot().currentToast).toBeNull();
});
