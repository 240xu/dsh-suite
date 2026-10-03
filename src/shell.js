// @240xu/dsh-suite — 故障隔离壳（web-all shell 模式的最小移植）。
//
// 模式来源：@linxin666/dsh-web-all（证据 aggregation-weball.md §5，
// lib/index.js:166-221 apply$1 / :4-12 globalThis 状态 / :52-76 degraded 路由）。
// 每个 family patch 行的 name 指向本文件（经 package.json exports 的各子路径，
// 全部重导出同一 apply/inject），真实插件包名在 config.plugin；本壳动态 import
// 它，import/start 失败只记录降级、绝不 rethrow——官方 loader 把一个 bundle 的
// 全部 patch 行当一个事务组挂载，裸挂时坏插件会 abort dsh web，壳把失败面
// 收窄到单行。
//
// 与 web-all 的刻意差异（骨架最小化）：
//   1. 无 activeRows 账本与 /rows 路由（那是为 browser half 折叠挂载服务的，
//      suite 各子包自带独立 dsh.client 声明，browser half 不经本壳）。
//   2. 保留 loopback-only /api/dsh-suite/degraded 健康路由（观测面），
//      注册走嵌套 inject(["webServer"]) fiber——壳比宿主 webServer 先激活，
//      直接读会 miss（web-all lib/index.js:117-141 同款时序处理）。

const KEY = Symbol.for("dsh-suite.shell-state");

/** 进程级共享壳状态：bundler 分裂多份模块副本时也只有一份（web-all 同款）。 */
function shellState() {
  return (globalThis[KEY] ??= { degraded: new Map(), healthRoutes: { count: 0 } });
}

/** 安全 JSON：circular/BigInt/toJSON 抛出时降级为占位串（0.1.4 P2 护栏）。 */
function safeStringify(value) {
  try { return JSON.stringify(value ?? null); } catch { return '"<unserializable>"'; }
}

/** 记录（或刷新）一行降级。错误在此打一次日志。
 *  0.1.4（P2）：整体自护栏——本函数若自己抛（stack getter/toString 抛），
 *  会逃出 applyShell 让壳行事务回滚整 bundle，恰是壳要防的失败面。 */
function recordDegraded(plugin, stage, error) {
  try {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`[dsh-suite] plugin degraded (${stage}): ${plugin}\n${message}`);
    shellState().degraded.set(plugin, { plugin, stage, message, at: new Date().toISOString() });
  } catch (e) {
    try {
      shellState().degraded.set(plugin, { plugin, stage, message: '<degrade ledger write failed>', at: new Date().toISOString() });
    } catch { /* 最后防线：静默——观测功能绝不反噬主流程 */ }
  }
}

export function listDegraded() {
  return [...shellState().degraded.values()];
}

/** 测试专用：清空降级账本。 */
export function _resetDegraded() {
  shellState().degraded.clear();
  shellState().healthRoutes.count = 0;
}

/** loopback-only 降级观测路由（每 shell 上下文注册一次）。 */
function makeDegradedRoute() {
  return {
    kind: "exact",
    path: "/api/dsh-suite/degraded",
    handler: async (req, res) => {
      let remote = req.socket?.remoteAddress ?? "";
      if (remote.startsWith("::ffff:")) remote = remote.slice(7);
      // 0.1.4（P2）：remoteAddress 之外必须校验 Host——evil.com TTL 重绑定到
      // 127.0.0.1 后 remoteAddress 仍是回环，仅靠它放行会泄露降级清单
      // （插件名 + error.stack 绝对路径）。Host 必须是本机名（对齐三兄弟的
      // Host 围栏为 arch-review 上线硬门槛）。
      const host = String(req.headers?.host ?? "").toLowerCase();
      const hostOk = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
      if (remote !== "127.0.0.1" && remote !== "::1" || !hostOk) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "forbidden: loopback-only" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, degraded: listDegraded() }));
    },
  };
}

/** 健康路由注册（webServer 迟到安全）：嵌套 inject fiber，随本行 dispose。 */
function holdHealthRoute(ctx) {
  ctx.inject?.(["webServer"], (scoped) => {
    const webServer = scoped.webServer;
    if (webServer === undefined || typeof webServer.register !== "function") return;
    const routes = shellState().healthRoutes;
    if (routes.count === 0) {
      try {
        routes.unregister = webServer.register(makeDegradedRoute());
      } catch (error) {
        console.warn("[dsh-suite] failed to register degraded route:", error);
        return;
      }
    }
    routes.count += 1;
    ctx.effect?.(() => () => {
      routes.count -= 1;
      if (routes.count <= 0) {
        routes.count = 0;
        try { routes.unregister?.(); } catch { /* already gone */ }
        routes.unregister = undefined;
      }
    }, "dsh-suite: health route");
  });
}

/** 已知退役/占位子包：老 profile 残留行挂成静默 no-op（web-all RETIRED_PLUGINS 同款）。 */
const RETIRED_PLUGINS = new Set();

/**
 * 挂载一行：config.plugin 指向的真实插件被包进本壳。
 * 失败语义：import 失败 / 模块无插件形状 / start 抛错或 reject →
 * recordDegraded 后 return，本行降级、其余行照常。
 */
async function applyShell(ctx, config) {
  holdHealthRoute(ctx);
  const spec = config?.plugin;
  if (typeof spec !== "string" || spec === "") {
    if (config === undefined || (typeof config === "object" && config !== null && Object.keys(config).length === 0)) return;
    recordDegraded("(no plugin)", "shape", new Error(`shell row config is missing the "plugin" package name (config: ${safeStringify(config)})`));
    return;
  }
  if (RETIRED_PLUGINS.has(spec)) return;
  let mod;
  try {
    mod = await import(/* @vite-ignore */ spec);
  } catch (error) {
    recordDegraded(spec, "import", error);
    return;
  }
  const plugin = mod?.default ?? mod;
  const usable =
    typeof plugin === "function" ||
    (typeof plugin === "object" && plugin !== null && typeof plugin.apply === "function");
  if (!usable) {
    recordDegraded(spec, "shape", new Error("module has no usable plugin shape (expected a function or { apply })"));
    return;
  }
  try {
    const fiber = ctx.plugin(plugin, config?.config);
    Promise.resolve(fiber).then(undefined, (error) => { try { recordDegraded(spec, "start", error); } catch { /* 观测不反噬 */ } });
  } catch (error) {
    recordDegraded(spec, "start", error);
  }
}

/** 壳必须先于一切激活：不依赖任何服务。 */
export const inject = [];

/** Host 侧插件体。 */
export function apply(ctx, config) {
  return applyShell(ctx, config);
}

export default { name: "dsh-suite-shell", inject, apply };
