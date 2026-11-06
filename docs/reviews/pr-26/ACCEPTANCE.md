# PR #26 修订记录（issue #3 切片 1）

Claim：`vss-3-lulu-20261025-01`。分支：`feature/3-multiview-drawing-export`。基线 main：`20aee5d1136bcfbec9b2a992aa5fbdfa25ff9eaf`。上一版取景修复：`99e40e1`。本文件随修订提交；精确 head SHA 写在 PR #26 描述里。

未改：`DRAWING_EXPORT_PX` 仍是 2048×1536，`DRAWING_EXPORT_FIT` 仍是 0.88，`placeExportCamera` 的距离与平移算法未动。未改 GLB、未改已有测试断言、未改产品默认入口（`SHOW_QUICK_ENTRIES` 仍为 false）。`?drawing-export=1` 只显示隐藏控件，不是权限。

## P2-1 生成中的同一拍导出

页面预览桥 `window.__drawingExport` 和隐藏按钮都改走 `requestDrawingExport`。门禁用 `generation.current !== null`，在调用车辆之前拒绝。

浏览器（headless Chrome，SwiftShader，`http://localhost:3000/?drawing-export=1`）：

- 拦截 `POST /api/generate`，挂起不响应，没有付费生成。
- 模型就绪后点灵感词，再在同一次脚本里点生成并立刻调用 `window.__drawingExport.exportDrawing('entry')`。
- 1.6 ms 内拒绝，文案是 “Line drawings cannot be exported while designs are generating.”
- 画布在调用前后都是 1084×828，没有停在 2048×1536。
- 挂起的请求只有这一条 `POST /api/generate`。

先红后绿：故意不设门禁时，该项测试不抛错（引擎仍被调用）。补上抛错后通过。

## P2-2 丢失的 WebGL 上下文

`exportDrawing` 在改场景之前检查 `gl.isContextLost()`。测量读像素和最终读像素都在读取前后再查一次。`toDataURL` 回退在返回之后再查一次；上下文已丢失时，即使返回的字符串以 `data:image/png` 开头也不当成成功。`renderer.info.render.frame` 没有增加时拒绝（测试替身没有 `info` 时跳过，已有的 toDataURL 成功用例保持原样）。

新增测试覆盖：丢失发生在改场景之前（渲染顺序为空、不调用 toDataURL）；读像素时丢失；渲染帧计数不增加；活着的上下文走 `readPixels` 且 `isContextLost` 至少被调用两次；读像素失败后走 `toDataURL`，调用期间把上下文标成丢失，返回值仍是 PNG，必须抛 `export-context-lost` 并恢复现场。`getContext` 在这些测试里返回假上下文，不再永远是 null。

## 无文字：停止，不放宽

只读查看了 `public/model/mxgarage-rv.glb` 的 JSON 块：68 个节点、55 个 mesh。节点名和 mesh 名里没有 text、logo、letter、badge、decal。没有可以单独 `visible = false` 再在 `finally` 恢复的 MXGARAGE 对象。

R13 已经从 `RV_Static_Chrome` 删掉字面三角形（索引三角形数 45004，字盒重心数 0）。额头上剩下的 928 个三角形是椭圆，仍在整车铬件里。徽标顶点在 `tests/fixtures/front-badge.json` 里，挂在 `RV_Static_Rubber` / `RV_Static_Chrome` 上，不是单独网格。`RV_Static_Body_Paint`、`RV_Static_Wrap_Front`、`RV_Static_Wrap_Rear` 是车身和包覆，藏掉会带走结构。

因此这一项没有改代码，也没有遮盖或裁切车身。dot 复核五张原图像素后的结论是：前 3/4、后 3/4、正面、背面四个视角都含 MXGARAGE，不只是正面和背面。无文字保持未勾选。资产拆分批准还没有收到。可选后续（本 PR 不做）：另开 GLB 修订，只删已确认的字面三角形，并按资产哈希链更新；不在这份 PR 里改共享 mesh 的索引。

## 本轮导出的墨迹盒

阈值：相对纸色 `#f1eee4` 的通道差 > 8。五张都是 2048×1536，左上角像素 241,238,228,255。导出后画布回到 1084×828，相机位置与目标与导出前相同。

| 视图 | 墨迹盒 | 长边 | 中心 |
| --- | --- | --- | --- |
| entry | 224,353–1831,1184 | 0.7852 | 0.5017, 0.5003 |
| front-three-quarter | 253,198–1800,1341 | 0.7559 | 0.5012, 0.5010 |
| rear-three-quarter | 263,224–1791,1321 | 0.7466 | 0.5015, 0.5029 |
| front | 537,208–1511,1341 | 0.7383 | 0.5000, 0.5042 |
| rear | 508,233–1526,1363 | 0.7363 | 0.4966, 0.5195 |

长边都在 0.70–0.90，中心距 0.5 不超过 0.05，四边都有余量。数字与取景修复后的一版一致。

`hero-before.png` 和 `hero-after.png` 只是页面前后对比（1440×900），不是旧导出和新导出的构图证明。五张构图证据是下面表格对应的 2048×1536 原图。本轮没有改相机。

## 跑过 / 没跑

跑过：上一轮新测试先红（6 失败，退出码 1）再绿；浏览器拦截生成；五张真实导出与墨迹盒。本轮 `toDataURL` 回退反例先红（1 失败，退出码 1，没有抛错），补上返回后的检查后通过。lint、test、tsc、build 的原文写在 PR 描述。

没跑：付费生成、合并、部署。维护者目检、切片 2 的 AI 出图、以及「无文字」都还不能勾。
