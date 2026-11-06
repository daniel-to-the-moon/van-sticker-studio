# Issue 41 实现与验证证据

执行者：Codex；角色：唯一实现者；原任务 `01a17e5b-6837-77ea-b6b3-581f511d8001`，本轮 run `01a18339-131e-75df-98ea-364c9005826f`。claim：`codex-issue41-local-palettes-20261027`。未自独立评审，独立评审由 dot 安排。

冻结 spec：`constitution.md`、`AGENTS.md`、`CONTRIBUTING.md`、PR 模板，完整版本 `c1666c2af070f36189f363c41b564074f5448c7b`；[范围/文件锁/验收](https://github.com/shengjun89/van-sticker-studio/issues/41#issuecomment-6448512217)。AGENTS §14 适用既有方向内细化、派单/认领、实现者准备 Draft PR；实际范围决策者 dot，维护者明确批准本次有限续行。没有合并、生产、费用、凭据、平台设置权限变更。

## 实现内容

| 文件 | 配色接入 |
| --- | --- |
| `lib/vehicle-palettes.ts` | 十个唯一 ID，Issue 原表 30 个近似 sRGB 色值；1.22/1.25m 唯一分区常量 |
| `lib/vehicle-wrap-editor.ts` | 扩展原单一 compile hook，在原 decal 前混色；只更新颜色 uniforms 的 setter |
| `components/studio/scene-engine.ts` | 内存状态与转发，模型加载后恢复；清贴纸时保持所选颜色可见，状态快照含 paletteId |
| `components/studio/VehicleScene.tsx` | prop 更新、lazy engine 创建后及 onReady 重放当前选择，presentation 同步 |
| `app/page.tsx` | 默认 null，主动点击进入 render，恢复原色与清贴纸分别处理，视图下方 picker 容器 |
| `components/studio/PalettePicker.tsx` / `.module.css` | 原生可访问按钮、双语名称/三色描述、aria-pressed/焦点与选中标记、可换行网格 |
| `lib/i18n.ts` | 仅新增配色文案 |
| `tests/vehicle-palettes.test.ts` | 枚举/字典、真实材质 hook/uniform、贴纸/落位/锁定/排除材料不变、engine 内存边界测试 |

所有现有文件仅改变配色接入。页面大块原有格式已保留，未混入 formatter 对旧逻辑的无关排版修改。未搬入 #26/#32/#43 差异、未重跑旧失败 QA，未触碰 #46。没有 GLB/几何、eligibility 扩大、AI 请求、Krea 素材、付费或新增持久化存储。默认禁用 uniform 保留原渲染；恢复不调用 `setImage`，不重设贴纸落位/锁定或安装新的 shader hook。

1.22m 以下主色，1.22–1.25m 细腰线，其上白色。坐标沿用现有 closed-pose `aWrapCoord.y`，边界用 fwidth 平滑；它是技术分区，不声称官方色号/精确物理分区，真实像素尚待核对。

## 已运行

云环境 Node v24.19.0。原安装参数错误、获准的一次修正及此前 focus 夹具失败原样见 `blocked-handoff.md`，未删除失败证据。本轮没有再次安装依赖。

| 文件 | 命令/受控场景 | 退出码 | 结果 |
| --- | --- | --- | --- |
| `01-normal-red.tap` | `node --experimental-strip-types --test tests/vehicle-palettes.test.ts`，原空枚举/缺失层/缺失 setter | 1 | 0 通过/3 预期断言红 |
| `02-normal-green.tap` | 原首次绿尝试，测试 canvas 缺 focus | 1 | 2 通过/1 非预期失败，当时立即停 |
| `03-focus-fix-green.tap` | 本次获准只补夹具 focus 后，同一命令 | 0 | 3 通过/0 失败 |
| `04-controlled-mutation-red.tap` | 同一命令，预先记录的 uPaletteEnabled 恒零故意破坏 | 1 | 2 通过/1 预期启用断言红 |
| `05-mutation-restored-green.tap` | 恢复原赋值后，同一命令 | 0 | 3 通过/0 失败 |
| `06-engine-controlled-red.tap` | 同一命令，新 engine setter 缺失 | 1 | 3 通过/1 预期断言红 |
| `07-engine-green.tap` | engine 接入后，同一命令 | 0 | 4 通过/0 失败 |
| `08-final-whitelist-green.tap` | `node --experimental-strip-types --test tests/vehicle-palettes.test.ts tests/wrap-layout.test.ts tests/wrap-lock.test.ts` | 0 | 10 通过/0 失败 |
| `09-safe-lint.txt` | 下列安全 lint | 0 | 无诊断 |

```bash
node_modules/.bin/oxlint --config /tmp/issue41-safe-oxlint.json --disable-nested-config --deny-warnings app/page.tsx components/studio/VehicleScene.tsx components/studio/scene-engine.ts lib/vehicle-wrap-editor.ts lib/vehicle-palettes.ts components/studio/PalettePicker.tsx tests/vehicle-palettes.test.ts lib/i18n.ts
```

安全 lint 的临时配置是现有 `.oxlintrc.json` 的规则/插件副本，仅 `options.typeAware` 与 `options.typeCheck` 为 false，以避免递归全项目类型扫描读取禁止文件。项目配置未修改；此限定检查不替代仓库完整 lint 门禁。所有白名单 import/fs 边界已核对，无私有身份/密钥/配置读取，无网络或 WebGL 构造。`source-manifest.json` 保全受测九个源码文件的 SHA256；精确最终 commit SHA 在 PR/Issue 交付回执中绑定，提交后还会核对 manifest。

## 未运行与验收缺口

- 本地完整 `npm run lint` / `npm test` / `npx tsc --noEmit` / `npm run build`：未运行。项目配置及全量测试可能隐式读取受保护文件；仅既有已获准 GitHub CI 可执行完整四门禁。CI 实际结果由最终 head 的 run/step 记录提供，不拿局部测试冒充。
- 未启动 dev、build、preview 或浏览器检查链。没有使用旧预览或 Krea 图充当当前 SHA 截图。
- 1280/390 无溢出、十套逐项点选/恢复、真实 GLB 异步加载、门窗动作、反光条/车牌/玻璃/轮胎真实像素对比均待准确版本浏览器检查；按钮/CSS 与代码实现不是这些检查的通过证据。
- 单测对待加载 engine 使用真实 prototype 和内存边界，没有实际下载 GLB。材质 hook 测试观察 shader 输出与 uniforms，没有 GPU 像素验证。
- 无独立 R1/R2、体验官或视觉通过结论；Draft PR 交付不等于获准评审/合并/上线。缺截图按冻结模板继续记缺口。

## 回滚与交接

运行时选择“恢复原色”关闭独立配色层；工程回滚可 revert 本 PR，不涉及模型或数据迁移。

本地分支 `feature/41-local-palettes`、目录 `/workspace/van-sticker-studio`。本任务未启动服务；安装和测试均已退出。最终 HEAD、远端 SHA、工作树和进程状态在交付回执列明，原失败记录保留。下一责任人为 dot：核对最终 CI 并安排无实现参与的独立评审和具备能力的准确版本视觉/运行时验证；本任务不合并、不部署。
