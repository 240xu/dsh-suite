# @240xu/dsh-suite

@240xu 生态一键聚合包（骨架 v0.1.0，可行性验证阶段）：一条命令安装全家，
逐行开关即回滚。架构依据专家组会签方案 `dsh-plugin-hub/docs/aggregation-weball.md`
（对 @linxin666/dsh-web-all 的逆向拆解）。

## 安装（骨架验证期用 link，发布后走 npm）

```sh
dsh plugin --profile web add @240xu/dsh-suite@latest   # 发布后
dsh web                                                # 重启生效
```

安装即引入五个子包（dependencies caret 区间）并挂载五条 family 行：

| 行 id | 子路径（shell） | 真实插件 |
|---|---|---|
| x240-websearch | @240xu/dsh-suite/websearch | @240xu/dsh-websearch ^2.7.2 |
| x240-message-ops | @240xu/dsh-suite/message-ops | @240xu/dsh-message-ops ^0.2.2 |
| x240-session-lazy-view | @240xu/dsh-suite/session-lazy-view | @240xu/dsh-session-lazy-view ^0.2.1 |
| x240-devkit | @240xu/dsh-suite/devkit | @240xu/dsh-devkit ^0.2.2 |
| x240-session-search | @240xu/dsh-suite/session-search | @240xu/dsh-session-search ^0.1.0 |

## 故障隔离（shell 壳）

官方 loader 把一个 bundle 的全部 patch 行当一个事务组挂载：裸挂时任一插件
import/start 失败会回滚整组并 abort `dsh web`。因此每行 `name` 指向本包的
shell 子路径（`src/shell.js`，永不失败），真实包名放在 `config.plugin`，由壳
动态 import——**失败收窄到单行**：记录降级（loopback-only
`GET /api/dsh-suite/degraded` 可查），其余行照常挂载。

## 逐行 disable（回滚主路径）

设置 → 插件 → 插件管理，或 profile 用户层 `cordis.patch.yml`：

```yaml
- id: x240-session-search
  disabled: true
```

被禁行不加载；其余行不受影响。无需卸载整包。

## 回滚 / 退出聚合

```sh
dsh plugin --profile web remove @240xu/dsh-suite
```

行 id 带 `x240-` 前缀，与各子包 standalone 安装的 id（`dsh-websearch` 等）不
冲突，可与 standalone 共存；两者都在时 standalone 优先（web-all 同款语义）。
只想要个别插件：直接 `dsh plugin add @240xu/dsh-websearch`，不经 suite。

## 与 web-all 模式的差异

1. suite 各子包自带独立 `dsh.client` 声明，browser half 不经壳折叠挂载——壳只
   管 host 半的故障隔离，因此没有 web-all 的 activeRows 账本与 /rows 路由。
2. caret 区间聚合（非家族 lockstep）：各子包独立发版独立更新，suite 只做下限约束。
3. 保留 web-all 的：globalThis 单例壳状态、RETIRED_PLUGINS 静默化机制位、
   loopback-only degraded 观测路由、嵌套 inject(["webServer"]) 时序处理。

## 验证状态

- 壳隔离语义：`npm test`（node --test）6 项全过——good 挂载 / import 失败降级 /
  shape 降级 / start 抛错降级且兄弟行照常 / 空行静默 / 健康路由迟到注册。
  fixtures 在 `node_modules/@240xu/mock-*`（模拟安装形态，发布前删除）。
- **尚未验证**：真实 `dsh plugin --profile web add link:…` + `dsh web` 的端到端
  bundle 装载（见下节步骤）。

## 端到端验证步骤（发布前必做）

1. `cd ~/dsh-plugins-src/dsh-suite && rm -rf node_modules`（清掉 PoC fixtures，
   换真实依赖：把五个子包目录 ln -s 进 node_modules/@240xu/，或 pnpm link）。
2. `dsh plugin --profile web add link:$(pwd)`（测试 profile 更稳：
   `--profile suitetest`）。
3. `dsh --profile suitetest --dump-config`：确认五条 x240-* 行存在、name 为
   shell 子路径、config.plugin 为真实包名。
4. `dsh web --profile suitetest`：五插件功能可用；
   `curl -s http://127.0.0.1:<port>/api/dsh-suite/degraded` 应返回
   `{"ok":true,"degraded":[]}`。
5. 故障注入验证隔离：临时改坏一个子包导出（或 patch 行 config.plugin 指向不存在
   的包名），重启 → `dsh web` 应正常启动，仅 degraded 列出该行，其余四行可用。
6. 验证 standalone 共存：同 profile 再 `dsh plugin add link:../dsh-devkit`，
   确认无重复 id 拒绝、设置页只出现一份 devkit 入口。
7. 全部通过后删除 fixtures、发 npm（先子包后 suite）。

## 端到端验证结果（2026-09-28，suitetest profile 实测）

| 步骤 | 结果 |
|---|---|
| 1. link 五个真实子包 | ✅（lazy-view 源码在 slv-check 目录，symlink 指向该处） |
| 2. `dsh plugin add link:` | ✅ suite 注册为 bundle |
| 3. dump-config | ✅ 五条 x240-* 行、name=shell 子路径、config.plugin=真实包名 |
| 4. `dsh --profile=suitetest --port 3999` | ✅ http=401、degraded 空、五端点全响应（400/200/200/401/200 均为预期值） |
| 5. 故障注入（session-search index.js 抛错） | ✅ **隔离生效**：服务正常启动（401），degraded 仅列 `@240xu/dsh-session-search [import]`，其余四行端点全部存活 |
| 6. standalone 共存（suite 内 devkit + standalone dsh-devkit 同 profile） | ✅ 启动无重复 id 冲突（bundle patch insert warn-and-skip）、degraded 空、/api/devkit/health 单实例 200、组合树出现 4 处 dsh-devkit 引用（suite 行+standalone 行+元数据） |

### 实测发现的运维事实（发布前须知）
1. **slv-check 裸克隆需要 node_modules shim**：`@deepseek-ai/schemastery` 指向 profile 安装（`ln -sfn <profile>/node_modules/@deepseek-ai/schemastery slv-check/node_modules/@deepseek-ai/schemastery`）。npm 发布版无此问题（真实安装由 pnpm hoisted 提供）。
2. **CLI 语法**：`dsh --profile=<name> --port <p> --no-open`（`--profile <name> web` 的 `web` 会被当多余 app 参数拒绝；`dsh <name> web` 同样）。
3. **profile 依赖两个内建 bundle**：`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`（缺后者则无 HTTP 面）。
4. 壳隔离在第 5 步经受住了真实故障注入——这正是专家组会签方案的核心验收。

## 端到端验证结果 R2（2026-09-30，真实 pnpm 依赖布局）

前置修正：上轮验证用的是手工 symlink；本轮改为**真实 pnpm 安装**（suite dependencies caret 刷新到
当前版本，node_modules/.pnpm 布局）。结果：
1. suite 自身 `pnpm install` 拉齐五子包（2.7.3/0.2.3/0.3.1/0.2.3/0.1.2）✅
2. profile `pnpm install` 级联（link: suite 保持自带 node_modules，shell 动态 import 从 suite 目录解析）✅
3. `dsh --profile=suitetest --port 3999` 启动 → degraded 空、五端点全响应 ✅
4. **故障注入（对 .pnpm 真实副本写 throw）** → degraded 精确列出该行，其余四行存活 ✅（隔离在 npm 布局下复验）
5. 逐行 disable 语义由 shell 兜底（上轮已验）

### 运维注意
- suite 以 link: 方式安装时，其 dependencies 由 suite 目录内 pnpm install 提供（profile 的
  install 不穿越 link 边界）——部署脚本必须先在 suite 目录跑 install。
- 上游 fix 后恢复：对 .pnpm 副本 `git checkout`/重装即可，无需重装整个 profile。
