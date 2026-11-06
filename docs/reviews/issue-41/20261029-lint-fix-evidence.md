# PR 47：一次限定 unbound-method 修正证据

执行者：Codex；原实现者。原任务 `01a17e5b-6837-77ea-b6b3-581f511d8001`，本轮 run `01a185bb-81a9-7249-b478-581f8c343f06`。沿用 `feature/41-local-palettes`、Draft PR #47、claim `codex-issue41-local-palettes-20261027`。

## 规格、许可与原失败

- 冻结 main/规则版本 `c1666c2af070f36189f363c41b564074f5448c7b`，原受阻 head `11988831d0252d7842e4b6e4b4cb1155854dec57`。
- 维护者 03:27 UTC 批准只修测试及证据，03:36 UTC 补充批准静态闭包核实、临时单文件诊断 tsconfig 及一次 type-aware JSON 定位。[公开授权记录](https://github.com/shengjun89/van-sticker-studio/pull/47#issuecomment-6487209450)、[accepted](https://github.com/shengjun89/van-sticker-studio/pull/47#issuecomment-6487244892)、[实际诊断开工](https://github.com/shengjun89/van-sticker-studio/pull/47#issuecomment-6487330168)。实际范围决策者 dot；按冻结 AGENTS §14 的认领/范围与明确保留边界实施，不自独立评审。
- [原 CI 40722620873](https://github.com/shengjun89/van-sticker-studio/actions/runs/40722620873) 的 checkout 是 synthetic merge `069cf97b19ed6bee456ad0dd5714b510af932a35`；lint 7 errors、0 warnings，test/tsc/build skipped。不是原 head 四门禁通过。
- 原 annotations 读取的 403 未重试；其阻塞事实见 `20261029-diagnostic-blocker.md`，原记录保留。本轮无安装、替代环境/分支/PR、规则或依赖修改。

## 诊断前静态边界核实

先使用已安装 TypeScript 5.9.3 的解析/模块解析 API 建立单根静态 program，只获取 source files，不调用语义诊断、emit、lint、项目源码或网络。读取入口在文件内容读取前检查规范化路径和 realpath；受保护目录/身份文件或不在公开源码/依赖/配置集合中的文件会直接使审计停止，不提供假内容，也不将阻止读取当作 lint 通过。

原 compilerOptions 下，单根测试的闭包为 1107 个 source files、1131 个唯一内容读取文件。项目内仅 13 个源码：测试、scene-engine、i18n、vehicle-palettes、vehicle-wrap-editor、wrap-layout、wrap-eligibility、drafting-edges、drawing-silhouette、wiper-calibration、vehicle-assets、stage-motion、stickers；其余为已安装依赖/声明、标准库和 package metadata。没有 GLB、运行时配置、`.openai/hosting.json`、身份文件或真实密钥读取。

运行前查证：[官方 CLI 文档](https://oxc.rs/docs/guide/usage/linter/cli.html) 明确 `--tsconfig` 只覆盖 import resolver，type-aware 后端仍就近发现配置。因此没有运行原先只靠该参数的不足方案；将获准的临时配置放在此前不存在的 `tests/tsconfig.json`，使用真实发现机制：

```json
{
  "extends": "../tsconfig.json",
  "files": ["vehicle-palettes.test.ts"],
  "include": []
}
```

解析后的根文件仍恰好一个，继承的 compilerOptions 逐项相同；静态闭包与原单根闭包完全一致，增加两份公开配置读取后为 1133。审计 protectedPathAccesses 为 0。原仓库 tsconfig/.oxlintrc 均未替换、屏蔽或修改；根 lint 配置只有内建插件，没有执行项目 JS 配置或自定义插件。

实际后端 debug 日志确认：目标文件分配给 `tests/tsconfig.json`，Total programs: 1、Unmatched files: 0，只 lint 该测试。后端 tsgolint 7.0.2001 的 program 为 1114 source files，与审计器版本不同；不把两个计数混写，不将静态审计说成 OS syscall trace。边界依据为配置根集合、已核对的静态引用闭包及实际后端项目分配，未借受限配置屏蔽刷绿。

完整读取路径与哈希见 `20261029-static-readset.sha256`，汇总见 `20261029-static-closure-summary.json`。两份只读审计脚本文本、临时配置文本及原始日志保全；完整原审计 JSON 仍在汇总列出的本云环境 `/tmp` 路径。临时活动配置在修正验证后已移除，不提交为项目配置。

## 全部七条实际本地定位

以下行/列均针对原 head 的测试文件，来自 `20261029-type-aware-before.json`，全部为 `typescript(unbound-method)`、severity error：

| 行:列（主要 label） | 实际位置 |
| --- | --- |
| 72:23 | 排除材料的 `surface.onBeforeCompile` 原引用读取 |
| 116:19 | 第一个测试解构 `cleanup` |
| 137:54 | 第二个测试解构 `cleanup` |
| 153:27 | 合格材料的 hook 原引用快照 |
| 185:27 | 合格材料的 hook 原引用严格比较 |
| 199:34 | 排除材料的 hook 原引用严格比较 |
| 208:27 | 第三个 editor/engine 测试解构 `cleanup` |

没有目标文件外的诊断，也没有额外类型错误；原候选 typeof setter 行不是这七条错误。与原 CI 规则、消息、数量和原源码一致，足以定位此次限定修正；原 CI 不提供逐条 annotations，因此不声称已作逐条 CI annotation 对照，正式结果仍须新 SHA 的 CI 验证。

## 唯一测试修正与断言保留

- `cleanup()` 方法简写改成不使用 this 的箭头属性；调用者与清理步骤不变。
- 四处 hook 读取改用 `readCompileHook(material)`：内部仅 `Reflect.get(material, 'onBeforeCompile')`，返回 unknown。返回的是原属性值，没有 bind、包装/替换 hook、调用 hook 或类型 any 绕过。
- 严格引用比较、45 个 assert 调用、枚举/色值/材质/落位/锁定/engine 验收全部保留，没有删除/降低断言、disable 注释或规则修改。
- AST 检查将新的原值读取规范化回原成员读取后，45 个 assert 调用表达式逐项相同；原 source manifest 中 8 个产品文件哈希全部相同。结果见 `20261029-assertion-preservation.json`。修正测试 SHA256：`a61189888ff3715e512f25e9d0c5a3562838775d448da5835ef368bc7041a055`。

## 实际命令与结果

诊断前与修正后均使用同一条窄命令、原 `.oxlintrc.json`、208 条规则及原 typeAware/typeCheck 设置，不运行 npm 启动链：

```bash
env -u NAPI_RS_NATIVE_LIBRARY_PATH -u NODE_OPTIONS OXC_LOG=debug node_modules/.bin/oxlint --config .oxlintrc.json --disable-nested-config --type-aware --type-check --format json tests/vehicle-palettes.test.ts
```

- 修正前：退出 1，恰好七条预期目标错误，JSON 与 stderr 分别为 `20261029-type-aware-before.json` / `.stderr.txt`。这是获准定位的已知红，不是修正后新的失败。
- 修正后：退出 0，1 个 lint 文件、208 条规则、0 diagnostics；原始结果为 `20261029-type-aware-after.json` / `.stderr.txt`。没有修正后再改/重跑的循环。
- `node --experimental-strip-types --test tests/vehicle-palettes.test.ts tests/wrap-layout.test.ts tests/wrap-lock.test.ts`：退出 0，10 通过/0 失败，见 `20261029-whitelist-after.tap`。
- 断言/产品哈希核对：退出 0，45 个调用保留，8/8 产品哈希一致。

上述本地检查发生于原 head 加测试修正的工作树；通过测试内容 SHA256 与最终提交树逐字映射。完整四门禁实际 checkout SHA、head 和日志将在原 PR 的新 CI 回执中明确，不自引用证据文件的提交 SHA。

## 未运行与下一棒

本地完整 lint/test/tsc/build/dev 继续未运行；窄 type-aware/type-check 不是四门禁全绿。完整门禁仅使用推送原 PR 后的既有已授权 CI。没有本轮真实模型/视觉检查、1280/390、键盘焦点、WebGL shader 或异步门窗验收；不以静态检查或旧 preview 替代。

本轮变更仅测试及原证据目录；原失败、403 与红绿记录保留。提交/推送后精确 SHA、实际 CI 结果和进程/工作树状态由 PR/Issue 交付回执给出。dot 安排无实现参与的独立评审；本实现者不 approve、不合并、不部署。
