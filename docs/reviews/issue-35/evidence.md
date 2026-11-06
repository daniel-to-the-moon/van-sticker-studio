# #35 证据笔记

执行者：Grok（以 shengjun89 身份）

本笔记是实现证据，不是独立评审结论，也不是验收通过。

- 任务：#35
- claim：`grok-issue35-default-placement-20261027`（dot 确认：issue #35 comment 6440292282）
- 实际执行者：Grok 协调的 Cursor 云 agent，`bc-be5f0dc9-5956-5c62-9d15-1fb97205031b`，https://cursor.com/agents/bc-be5f0dc9-5956-5c62-9d15-1fb97205031b
- 冻结 spec / base SHA：`c1666c2af070f36189f363c41b564074f5448c7b`
- 受测代码 SHA：`0130f2f690f4b215860a0c1f33b77f4fdfd39f07`（实现与测试）
- 最终 head：本文件提交之后的分支 head。相对受测 SHA 只增加本笔记，实现与测试未改。四门禁没有在最终 head 上重跑。
- 环境：Node `v22.23.4`，npm `10.9.9`。依赖由本轮 `npm ci` 安装（退出码 0）。未读取、未改写 `.openai/hosting.json`。

## 门禁（受测 SHA `0130f2f`）

| 命令 | 开始时间 (UTC) | 退出码 | 结果 |
| --- | --- | --- | --- |
| `npm run lint` | 2026-10-27T11:24:47Z | 0 | oxlint 无诊断输出，按 0 error / 0 warning 记录 |
| `npm test` | 2026-10-27T11:24:52Z | 0 | `# tests 116` `# pass 116` `# fail 0` `# duration_ms 18062.456489` |
| `npx tsc --noEmit` | 2026-10-27T11:25:14Z | 0 | 无类型错误输出 |
| `npm run build` | 2026-10-27T11:25:21Z | 0 | vinext build 完成。构建器另打印一条 >500 kB chunk 提示，退出码仍为 0 |

未运行：浏览器关键路径、同视角截图、线稿目检、#26 普通/线稿与导出语义。没有这些就不能写成视觉验收或 #26 已核实。

## 先红后绿

`node --experimental-strip-types --test tests/wrap-default-placement.test.ts`

- 只有新测试、编辑器仍是冻结实现时：退出码 1，8 fail / 0 pass，`# duration_ms 595.706488`。失败点是没有 `entryDoorSpan` / `entryDoorClear` / `entryAdjusted`。这次红跑没有单独提交 SHA。
- 实现写入后、并包含在受测 SHA 的 `npm test` 里：该套件 8 pass，整次 `npm test` 116 pass / 0 fail。

## 闭合姿态与门区间

GLB 休息姿态下 `WebRig_EntryDoor` 的 position / quaternion 与 `motion_metadata.json` 里 `entry-door` 的 `closedPosition` / `closedQuaternion` 一致（测试容差 1e-5）。`closedQuaternion` 为 `[0, 0, 0, 1]`。缓存发生在构造函数 `centerZ` 回填之后，换图和 `reset()` 不再读网格。测试把该节点绕 Y 转 180° 后，缓存区间和避门摆位不变。

`centerZ`（`RV_Static_Wrap_*` 世界包围盒）= `-0.047314226627349854`。

入户门取 `RV_WebRig_EntryDoor_Body_Paint`、`RV_WebRig_EntryDoor_Chrome`、`RV_WebRig_EntryDoor_Glass`、`RV_WebRig_EntryDoor_Graphite`、`RV_WebRig_EntryDoor_Wrap_Entry` 的闭合姿态世界包围盒并集，八个角经 `perimeterCoordinate`（含 `px = dx / r`，不是 `2.95 - x`）投影：

- s：`[2.0600086416783867, 2.7133512014561596]`
- h（世界 y）：`[0.5250134468078613, 2.3092119693756104]`

四个角的 xz 都落在入户侧，且 `s1 - s0` 小于半周长、`s0 > 0`，不跨后缝。编辑器缓存与测试里的独立投影一致。

安全边距 `0.05 m` 只用于车尾段 `[0.05, s0 - 0.05]`。判交用 `constrainDecal` 之后的最终矩形对原始门矩形，没有再加一次边距。

## 四张 PNG（IHDR，无新依赖）

| 样例 | 宽 × 高 | 宽高比 | 结果 | center | height | scale |
| --- | --- | --- | --- | --- | --- | --- |
| alpine-club | 2098 × 749 | 2.801068090787717 | cleared | 1.0300043208391934 | 1.28 | 0.5600024690509676 |
| coast-club | 2092 × 752 | 2.7819148936170213 | cleared | 1.0300043208391934 | 1.28 | 0.5600024690509676 |
| night-route | 2065 × 762 | 2.70997375328084 | cleared | 1.0300043208391934 | 1.28 | 0.5600024690509676 |
| sun-chaser | 2098 × 749 | 2.801068090787717 | cleared | 1.0300043208391934 | 1.28 | 0.5600024690509676 |

四张都是 cleared，没有整组降级。`placements[1]` 仍等于旧默认再经 `constrainDecal`。另有一个合成窄门用例：显式 `entryDoorClear=false`，摆位退回旧默认，且该旧默认与门相交；这不计入上面的四张样例。

## 待未参与者独立复核

Grok 与本云 agent 都参与了实现，不能给独立通过结论。待核事项：

- `lib/vehicle-wrap-editor.ts` 与 `tests/wrap-default-placement.test.ts` 是否符合冻结修正 1–3
- 最终矩形判交、边距只加一次、脏标记只跟踪入户侧
- 真实画面里字样是否躲开门缝、门窗和把手（本轮无截图）
- #26 普通/线稿及导出是否仍使用同一 `placements`（本轮未读 #26 diff，未改材质遮罩）

## 回滚

revert Draft PR #43 即可。未改 GLB，也未改三处哈希。

## 唯一下一步

请 dot 指定一名未参与本实现的评审者，只读复核 Draft PR #43 的最终 head。不要合并，不要部署。
