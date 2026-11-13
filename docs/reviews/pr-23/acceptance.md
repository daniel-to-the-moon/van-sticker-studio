# PR #23 导航证据记录

本记录只保存本任务的验证事实，不新增或修改治理规则、规格或产品行为。

## 绑定与授权

- PR：[#23](https://github.com/shengjun89/van-sticker-studio/pull/23)，仅关联 [Issue #21](https://github.com/shengjun89/van-sticker-studio/issues/21) 的返回工作台导航切片。
- claim：`vss-21-nav-gpt-20261025-01`。
- 唯一规则基线：main `20aee5d1136bcfbec9b2a992aa5fbdfa25ff9eaf`。
- 精确实现 SHA：`d71bc12213f28afe7ba1310881b7d5585f0cfeed`。本轮未改该实现的产品代码或测试。
- 初始文件边界及验收：[Issue #21 dot 协调评论](https://github.com/shengjun89/van-sticker-studio/issues/21#issuecomment-6402131087)。
- 本轮补证据授权及有界验证要求：[PR #23 dot 协调评论](https://github.com/shengjun89/van-sticker-studio/pull/23#issuecomment-6402310794)。额外文件仅限 `docs/reviews/pr-23/` 的项目界面 PNG 与验收记录。

所依据的既有规则均固定到上述 main 提交：

- [constitution.md](https://github.com/shengjun89/van-sticker-studio/blob/20aee5d1136bcfbec9b2a992aa5fbdfa25ff9eaf/constitution.md)：第 1、3、4、5 条，分别为维护者拍板、PR 制、四项门禁与维护者目检。
- [AGENTS.md](https://github.com/shengjun89/van-sticker-studio/blob/20aee5d1136bcfbec9b2a992aa5fbdfa25ff9eaf/AGENTS.md)：第 1、3、6、7、8、9 节，覆盖门禁、视觉验收、交接、禁区、评审分离和先证伪。
- [CONTRIBUTING.md](https://github.com/shengjun89/van-sticker-studio/blob/20aee5d1136bcfbec9b2a992aa5fbdfa25ff9eaf/CONTRIBUTING.md)：第 1、3、6、7 节，覆盖任务流程、提交、前后截图与评审分离、权限。

## 已有截图及导航验证

截图由真实本地页面和 Chromium 154 生成，只含项目页面；无桌面、账户界面或私有配置。原始 PNG 按字节复制入本目录，没有重绘或改图。

修改前为 main 基线页面；修改后为精确实现 SHA 的页面。前后均使用中文、演示车型、默认摄像机与相同 viewport。窄屏截图记录首屏导航布局，3D 区域按原有页面布局位于下方。

| 证据 | 1280×900 | 390×844 |
|---|---|---|
| 修改前 | [before-desktop](./before-desktop-1280x900.png) | [before-mobile](./before-mobile-390x844.png) |
| 修改后 | [after-desktop](./after-desktop-1280x900.png) | [after-mobile](./after-mobile-390x844.png) |
| 自然 Tab 焦点 | [focus-desktop](./focus-desktop-1280x900.png) | [focus-mobile](./focus-mobile-390x844.png) |
| 英文文字 | [english-desktop](./english-desktop-1280x900.png) | [english-mobile](./english-mobile-390x844.png) |

初次浏览器验证在 2026-10-25 19:35:02–19:35:20 UTC 执行，`node /tmp/vss-21-nav-evidence/after.cjs` 退出码 0，55/55 检查通过：

- 两宽度下首次自然 Tab 到达返回链接，实际 DOM 为 `A`、`href="/"`，焦点环为 3px、offset 4px。
- “返回工作台”和“Back to studio”均可按 Enter 返回 `/`，链接不遮挡语言按钮。
- 车型选择、语言切换、附件与车顶占位的允许操作、恢复默认、回到演示视图、canvas 拖动/缩放通过。
- 该轮脚本到达首页 URL 后很快离开，不能凭其 55 项结果认定首页模型完整加载成功。

## 精确实现的门禁与先证伪证据

| 命令 | 退出码 | 事实 |
|---|---:|---|
| `npm test`，main 基线 | 0 | 108 pass / 0 fail |
| `node --experimental-strip-types --test tests/bodylab-navigation.test.ts`，无链接 | 1 | 0 pass / 2 fail |
| 同上，故意将目标改为 `/body-lab` | 1 | 0 pass / 2 fail |
| 同上，按字节恢复实现 | 0 | 2 pass / 0 fail |
| `npm run lint` | 0 | 0 error / 0 warning |
| `npm test` | 0 | 110 pass / 0 fail |
| `npx tsc --noEmit` | 0 | 无编译错误 |
| `npm run build` | 0 | 构建完成，有 >500kB chunk 提示 |

[初次 PR CI run 40227125141](https://github.com/shengjun89/van-sticker-studio/actions/runs/40227125141) 为 success。根据上述 dot 协调评论，该 PR CI 实际 checkout 是 synthetic merge `22d081382cd82f1ce5eef11ad23bb5f93e75e60b`，不将其描述为直接在 head-only 上执行。

本轮添加证据目录后重新执行四项本地门禁：`npm run lint` 退出码 0（0 error / 0 warning），`npm test` 退出码 0（110 pass / 0 fail），`npx tsc --noEmit` 退出码 0，`npm run build` 退出码 0（仍有 >500kB chunk 提示）。日志保存在本轮 Library 证据包的 `browser/bounded-return/evidence-*.log`；没有把前一轮结果冒充新执行。

## 本轮有界返回与模型终态验证

本轮实际结果为 **INCONCLUSIVE（未决）**，测试命令退出码 **2**，不是模型成功或明确失败。

- 时间：2026-10-25 19:48:59.507–19:49:06.892 UTC，7,385 ms。
- 实际动作：一个 context、一次初始 `/body-lab` 访问、一次返回链接激活；Back 0、Forward 0、主动 reload 0、retry 0。
- 阻塞：首个 DOM 快照碰到文档导航，Playwright 抛出 `page.evaluate: Execution context was destroyed, most likely because of a navigation`，测试按有界约束停止，未自动重试。
- 首页 `/` 文档响应 200，但停止截图仍为“Unfolding your body drawing / Preparing the 3D view…”且 Reset all 禁用，不是模型终态。关闭前没有记录到关键模型/元数据请求，不能据此推断模型成功。
- 本轮未记录到 requestfailed、HTTP ≥400、pageerror 或 `Vehicle load failed` console error。记录到的 warning 为 Chromium GL ReadPixels 性能提示。观测窗口不完整，不能把这些零计数当作加载成功证据，也不能据此解释旧 `Failed to fetch`。
- 首轮成功未成立，因此未执行 Back/Forward；模型终态及历史导航验证仍未完成。

完整判据、动作计数、脱敏 network/console 时间线和停止边界见 [有界验证记录](./bounded-return.md)，停止状态见 [stopped-inconclusive.png](./stopped-inconclusive.png)。没有在本轮修改脚本后再次访问页面。

## 局限与交接

- 旧 dev 会话出现 `Vehicle load failed: Failed to fetch`，也有 HMR、多 renderer 和依赖优化 warning。旧脚本快速离开首页；这些记录既不能直接判为正常取消，也不能直接归因导航改动。本轮结果单独记录。
- 本任务不改首页、模型、参数化、渲染、配置、权限或治理文件；不调用生成/留资接口，不配置凭据，不主动执行部署或合并。
- 实现者未自审。dot 的独立静态预审结论见授权评论，不能替代正式视觉评审或维护者目检；#21 其它产品项保持未完成。
- 原始脚本、日志和完整截图保留在本云任务 `/tmp/vss-21-nav-evidence/` 及同名 Library 证据包。Library 文件身份为 `libfile_5eda0dae90f08191a3d8d23879484b66`，具体版本由本轮 PR 交接评论记录。

## 入仓库 PNG 的 SHA-256

| 文件 | SHA-256 |
|---|---|
| after-desktop-1280x900.png | `39fedba50b37b635ca544cd9cafd0e3bd5520dd8772e6ab823c5093cfb0e7b93` |
| after-mobile-390x844.png | `c34754de4829a4d53a20718591b0446ae443b758ffc84b69c6d4ef44974d83f7` |
| before-desktop-1280x900.png | `825f29b619bf32ace8dbe621c55eb1a14e8766bcb94e29720680336d719f1789` |
| before-mobile-390x844.png | `9172846966d24afa9eeb5e7d4fa21498b3e54b1239c8f915c7ec9ba7026b6007` |
| english-desktop-1280x900.png | `3314c574e67a99bec5929810d3a96eecf0cd2b83d8490ec1d78cf49de39db81d` |
| english-mobile-390x844.png | `f77a77dad61d529c5c3e2e1db095647a977de310ae1418f6eb61960526870eea` |
| focus-desktop-1280x900.png | `3a6321dafec64a20965919cc51f17a4db1b107b3852aa689f3af72a76daacd17` |
| focus-mobile-390x844.png | `b8a5efddaeeddd59873f5f4fbe4fa559fa8141f95d96b2c246226bd5bff44421` |
| stopped-inconclusive.png | `a8820331aea1a617f62ed209464f52ac55d1ceec2e58a0e2ee2990af2a63fdaa` |
