import test from "node:test";
import assert from "node:assert/strict";
import { apply, listDegraded, _resetDegraded } from "../src/shell.js";

// 最小 cordis 风格 ctx 桩：effect 登记清理项、inject 捕获子 fiber、plugin 记录挂载。
function makeCtx() {
  const mounted = [];
  const effects = [];
  const injected = [];
  const ctx = {
    mounted, effects, injected,
    effect(fn, label) { effects.push({ fn, label }); },
    // 与 cordis 语义一致：ctx.plugin 同步调用插件 apply（同步抛错由壳的 try 捕获）
    plugin(p, config) { const r = typeof p === "function" ? p(ctx, config) : p.apply(ctx, config); mounted.push({ name: p?.name ?? "anon", config }); return Promise.resolve(r); },
    inject(_, fn) { injected.push(fn); },
  };
  return ctx;
}

test("good plugin mounts through the shell", async () => {
  _resetDegraded();
  const ctx = makeCtx();
  await apply(ctx, { plugin: "@240xu/mock-good" });
  assert.equal(ctx.mounted.length, 1);
  assert.equal(ctx.mounted[0].name, "mock-good");
  assert.equal(listDegraded().length, 0);
});

test("import failure degrades the row without rethrowing", async () => {
  _resetDegraded();
  const ctx = makeCtx();
  await assert.doesNotReject(() => apply(ctx, { plugin: "@240xu/mock-badimport" }));
  assert.equal(ctx.mounted.length, 0);
  const d = listDegraded();
  assert.equal(d.length, 1);
  assert.equal(d[0].plugin, "@240xu/mock-badimport");
  assert.equal(d[0].stage, "import");
});

test("bad shape degrades instead of aborting", async () => {
  _resetDegraded();
  const ctx = makeCtx();
  await apply(ctx, { plugin: "@240xu/mock-badshape" });
  assert.equal(ctx.mounted.length, 0);
  assert.equal(listDegraded()[0].stage, "shape");
});

test("start throw degrades, sibling rows still mount (isolation semantics)", async () => {
  _resetDegraded();
  const ctxA = makeCtx();
  await apply(ctxA, { plugin: "@240xu/mock-badstart" });
  assert.equal(ctxA.mounted.length, 0);
  const ctxB = makeCtx();
  await apply(ctxB, { plugin: "@240xu/mock-good" });
  assert.equal(ctxB.mounted.length, 1);
  assert.equal(listDegraded().find((d) => d.stage === "start").plugin, "@240xu/mock-badstart");
});

test("bare-row / empty config mounts quietly (override shape)", async () => {
  _resetDegraded();
  for (const config of [undefined, {}]) {
    const ctx = makeCtx();
    await apply(ctx, config);
    assert.equal(ctx.mounted.length, 0);
    assert.equal(listDegraded().length, 0);
  }
});

test("health route registers via nested webServer inject fiber", async () => {
  _resetDegraded();
  const ctx = makeCtx();
  await apply(ctx, { plugin: "@240xu/mock-good" });
  assert.equal(ctx.injected.length, 1);
  // 模拟 webServer 服务迟到后 fiber 执行
  const fakeWs = { register: (route) => { return () => {}; } };
  let subWebServer;
  ctx.inject = (deps, fn) => { subWebServer = fn({ webServer: fakeWs }); };
  ctx.injected.forEach((fn) => fn({ webServer: fakeWs }));
  assert.ok(ctx.effects.some((e) => String(e.label).includes("health route")));
});
