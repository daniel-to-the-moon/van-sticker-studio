# Issue #2：验收清单与覆盖实话

执行者：Grok（以 shengjun89 身份）。claim `grok-issue2-r13-generator-20261027`。云任务 `bc-2da5f480-4c28-5d64-b7f1-0af71525b603`。

冻结规范：main `c1666c2af070f36189f363c41b564074f5448c7b`。

精确最终 head 记在 PR 正文。本文档与受测代码同一提交，避免在文档里写会随下一次提交变化的自引用 SHA。

独立评审必须由没有参与本次实现的人做。实现者不自审。

落地到 main、以及落地后的 GLB 哈希链，由维护者执行。本次只开 Draft PR，不合并，不推 main。

协调约束：issue 评论 6445598236、6445434425。

## 兼容边界

只有带已核实 `frontOverhangMm` / `rearOverhangMm` 的登记输入进入精细生成器。缺这两个字段的默认演示保持原示意行为，包括 3.05 m 车高加 0.08 m 顶板。既有 `tests/parametric-body-scene.test.ts` 没有改断言。

`buildParametricBody` 在 `motorhome-b` 上先看 `verifiedMotorhomeBOverhangs`。两个前后悬都是有限数才调用 `buildMotorhomeBDetail`，否则走原来的 `buildVanBody(config, 0.55, 0.36)`。

`requireVerifiedOverhangs` 在生成器内部拒绝缺数据：车种不是 motorhome-b，或任一前后悬缺失 / 非有限数，直接抛错。不再用 R13 前后悬比例填空。

`app/body-lab/page.tsx` 只在选中登记行时，把该行 verified 的前后悬写进配置。选回空模型时 `setConfig({ ...DEFAULT_BODY_CONFIG })`，精细字段被清掉。面板上的「恢复默认」在写锁外，它调用的 `configForRegisteredModel` 本身不复制前后悬，所以那次 `onChange` 也会清掉精细字段。没有改公告库，没有加自由滑杆。

页头、导航、Link 导入和返回工作台链接没有动。相对冻结 main，该文件的 diff 只有登记配置转换和前后悬接线。

## 新测试的读取链

`tests/body-lab-detail.test.ts` 的 import 停在：

- `node:test`、`node:assert/strict`、`node:fs`、`three`
- `lib/parametric-body.ts`（无进一步本地 import）
- `lib/parametric-body-detail.ts`（`three`、`parametric-body`）
- `lib/parametric-body-scene.ts`（`three`、`parametric-body`、`parametric-body-detail`）
- `lib/announcement-db.ts`（只引 `parametric-body`）

`fs` 只读 `lib/announcement-db.json`，以及 `page.tsx`、`parametric-body-scene.ts`、`parametric-body.ts` 的源码文本。没有 import `announcement-db-data.ts`、`page.tsx`、`vite.config.ts`，也没有读 `.openai/hosting.json`。

白名单另外两份：`tests/parametric-body.test.ts` 只引 `parametric-body.ts`；`tests/parametric-body-scene.test.ts` 引 `parametric-body.ts` 与 `parametric-body-scene.ts`。都没有碰到受保护配置。

## 先红后绿（AGENTS.md §9）

第一轮，精细测试对着冻结 main 的旧示意车体：

```text
node --experimental-strip-types --test tests/body-lab-detail.test.ts
# tests 8
# pass 1
# fail 7
退出码 1
```

失败要点：`sh6601h4db-s-h2525` 包围盒高 2.605 m（配置高 2.525 m 再加 0.08 m 顶板）；没有 `wheel-tire`；没有 `shell` 和其它 `userData.feature`；页面当时没有 `front_overhang_mm`。当时已绿的一条是 11 条部分行的既有公告库行为，不算新行为的先证伪。

第二轮，兼容边界测试写好后、改路由之前（当时 motorhome-b 一律进精细生成器）：

```text
node --experimental-strip-types --test tests/body-lab-detail.test.ts
# tests 11
# pass 7
# fail 4
退出码 1
```

失败：缺前后悬没有抛错；默认演示高 `3.050000008969009`；清掉前后悬后仍有 `shell`；场景源码里没有 `verifiedMotorhomeBOverhangs`。

改完边界后，白名单三文件一起：

```text
node --experimental-strip-types --test tests/body-lab-detail.test.ts tests/parametric-body.test.ts tests/parametric-body-scene.test.ts
# tests 45
# pass 45
# fail 0
退出码 0
```

第三轮，故意改坏实现：生成器把缺失前后悬当成 0，并且 motorhome-b 不再走示意分支。同一条白名单里的前两份文件：

```text
node --experimental-strip-types --test tests/body-lab-detail.test.ts tests/parametric-body-scene.test.ts
# tests 21
# pass 17
# fail 4
退出码 1
```

失败：缺数据没有抛错；默认演示高仍是 `3.050000008969009`；清掉前后悬后 `shell` 数是 1；既有断言 `schematic body spans the configured length and height` 报长度 `6.1944000852108`。没有改那条既有断言。

随即把这两处改回。恢复后同一条三文件白名单再次：45 项，通过 45，失败 0，退出码 0。

## 验收条目

- [x] 24 条完整行 F+WB+R=L 精确。带已核实前后悬时，包围盒长 ±0.01 m、高 ±0.02 m；车轮 min.y 为 0；轴 x 为 −L/2+前悬与前轴+轴距。判定：`tests/body-lab-detail.test.ts`。
- [x] 11 条部分行可见、不可选、无配置输出。没有补造尺寸。
- [x] 缺前后悬的默认演示保持示意车体：高 3.05 m + 0.08 m 顶板。既有 `tests/parametric-body-scene.test.ts` 原样通过，断言未改。
- [x] 精细生成器对缺前后悬、以及非 motorhome-b，抛错拒绝。
- [x] 清掉前后悬后回到示意车体。页面把空选择恢复成 `DEFAULT_BODY_CONFIG`。
- [x] lint 0 error / 0 warning。`npm run lint` 退出码 0。
- [ ] 全量 `npm test` 通配扫描。本轮按协调者要求未运行。
- [ ] `npx tsc --noEmit` 未运行。
- [ ] `npm run build` 未运行。不能声称构建产物包含 `/body-lab`。
- [ ] 推 main 后的线上 `/body-lab` 未验证。
- [ ] R13 GLB 上线哈希链未在本次验证。工作树哈希与 issue 给定值一致，见 measurement.md。

## 未运行的 tsc、build 与全量扫描

`vite.config.ts` 有 `import hostingConfig from './.openai/hosting.json'`。`tsconfig.json` 含 `**/*.ts` 且 `resolveJsonModule` 为 true，因此 `npx tsc --noEmit` 会读该文件。`npm run build` 会加载同一份 vite 配置。

这两项未运行。没有打开、创建或伪造 `.openai/hosting.json`。CI 若覆盖它们，结果以获准 CI 为准。

`npm test` 是 `tests/*.test.ts` 通配扫描。协调者要求只跑显式白名单，本轮没有跑通配扫描。

`npm run lint` 的路径是 `app components/studio lib tests`，不包含 `vite.config.ts`。退出码 0。更早一次 lint 曾因 `frontOverhangMm` 可能为 undefined 失败（退出码 1，4 条 TS18048），收窄类型后已通过。

## 未验证

- 浏览器截图、同视角前后对比
- 线稿模式（`THREE.EdgesGeometry` 目检）
- 线上 `/body-lab`
- 落地后的 GLB 哈希链（工作树 / GitHub 原始文件 / 线上 demo 三者）
- 体验官 drawing 验收

以上都不能当成视觉通过。模型是设计展示，不是原厂几何，不能按图开料。

## 覆盖实话

- 只在带齐已核实前后悬的 motorhome-b 上使用精细生成器。24 条完整公告行对应 8 个公告型号（各高度变体分行）。
- 缺前后悬的默认演示、以及清掉这些字段之后，仍是原来的示意车体和 0.08 m 顶板。
- 11 条部分行仍缺尺寸，保持不可选，没有配置输出。
- camper、越野、客车、C 型、皮卡、拖挂仍是示意模型。
- 这是设计展示用的范式车体。不得按图开料，不得声称为原厂精确几何，不声称 V80 身份。
- 厨房窗与卫浴窗用的是 V02 实测同一对 y（1.8837–2.3067 m）。入户侧是额头、生活前、生活后、入户门玻璃、驾驶舱玻璃。没有额头眉带。
- 窗框边宽 0.035 m。
- Draft PR #23 也改 `app/body-lab/page.tsx`，范围是 Link 导入和返回工作台页头。本分支没有碰那些行。

## 命令

环境：Node v22.23.4。时间：2026-10-27。工作树 GLB 哈希见 measurement.md。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node --experimental-strip-types --test tests/body-lab-detail.test.ts`（对着冻结 main 的旧示意车体） | 1 | 8 项，通过 1，失败 7 |
| 同上（兼容测试已加入、路由未改） | 1 | 11 项，通过 7，失败 4 |
| `node --experimental-strip-types --test tests/body-lab-detail.test.ts tests/parametric-body.test.ts tests/parametric-body-scene.test.ts`（边界改完） | 0 | 45 项，通过 45，失败 0 |
| 同上前两份文件（故意改坏：缺数据当 0，且 motorhome-b 一律进精细生成器） | 1 | 21 项，通过 17，失败 4 |
| 三文件白名单（改回之后） | 0 | 45 项，通过 45，失败 0 |
| `npm run lint` | 0 | oxlint 无 error / warning 输出 |
| `npm test` | 未运行 | 通配扫描不在本轮授权内 |
| `npx tsc --noEmit` | 未运行 | 会经 `vite.config.ts` 读取 `.openai/hosting.json` |
| `npm run build` | 未运行 | 同上 |
