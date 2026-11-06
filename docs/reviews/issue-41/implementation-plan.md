# Issue 41 local palettes implementation plan

执行者：Codex，唯一实现者；原 claim、原分支、原任务续跑。独立评审由 dot 另行安排，本任务不作独立自评。

Goal: 用户主动点选十套本地近似 sRGB 配色，保留默认原外观、既有贴纸与交互。

Architecture: `lib/vehicle-palettes.ts` 提供枚举和唯一分区常量；在现有 wrap shader hook 内、decal 混色之前加入受现有 eligibility 限制的独立 uniform 层。React 与 engine 通过 `setPalette(palette: VehiclePalette | null)` 同步，异步加载后重放最新状态。`PalettePicker` 放在 3D 视图下方，CSS module 负责换行与窄屏布局。

Spec: [冻结 claim](https://github.com/shengjun89/van-sticker-studio/issues/41#issuecomment-6448512217)，main/spec `c1666c2af070f36189f363c41b564074f5448c7b`，AGENTS §9/§14。继续许可来自维护者 17:28 UTC 回复，经 dot 于本任务传达。

## 约束与选择

- 仅原文件锁；不新增依赖、AI、存储、样式选择、GLB/几何、workflow 或正式规则变更。
- 默认 `null`；恢复只关闭配色层，不调用 `setImage`，不改变贴纸锁定/位置。
- 分区采用现有 closed-pose `aWrapCoord.y`：下部主色到 1.22m，1.22–1.25m 为细腰线，其上白色。属于实现技术常量，尚需准确版本真实像素核对，不声称原厂分区。
- 延用现有 hook，不重新安装或覆盖已有 `onBeforeCompile`；uniform 以 Three Color 将 sRGB 转为工作色域。
- 沿用当前框架与材质；用户已经冻结实现方式并批准直接续跑，不新增设计确认、子实现者或自独立评审。

## 任务与验证顺序

- [x] 写 `tests/vehicle-palettes.test.ts`：十唯一 ID/30 精确色值和中英名称；真实 editor 编译输出中的默认关闭/独立 uniform/混色顺序；十套切换与恢复不变贴纸、落位、锁定、hook、目标外材料；活动件变换不改 closed chart。
- [x] 受控正常红：新枚举先为空的类型骨架，editor 尚无 `setPalette`；预期仅枚举断言与缺失 setter 断言失败。运行 `node --experimental-strip-types --test tests/vehicle-palettes.test.ts`，保存原始输出及退出码。出现其它失败即停。
- [x] 实现枚举与 editor 独立层；同命令预期全部通过。
- [x] 受控故意破坏：只把 `setPalette` 的 `uPaletteEnabled` 赋值临时改为恒零；同命令预期独立层启用断言失败。恢复该赋值，同命令预期全部通过。记录临时 diff、输出和恢复证据，测试断言不变。
- [x] 接入 engine（加载后恢复）、VehicleScene（prop 与 onReady 重放）、page（原色状态、点击 render、清贴纸时保留配色）、双语 picker 与 CSS module（下方两列/多列布局）。在新增测试中用真实 engine prototype 验证待加载状态、render 模式及后续 setter 转发，不创建 WebGL/网络会话。
- [x] 安全 lint：仅显式锁定源文件，沿用仓库规则并在临时本地配置中关闭会递归全项目扫描的 typeAware/typeCheck；不称其为完整 lint 门禁。完整四门禁由原 CI 在最终 SHA 实际运行。
- [x] 白名单回归只运行 `tests/vehicle-palettes.test.ts`、`tests/wrap-layout.test.ts`、`tests/wrap-lock.test.ts`；不触发旧失败 QA 或本地全量检查。
- [ ] 核对最终 scope、最新认领/远端，提交并推送 Draft PR，记录精确 SHA、CI 实际结果和未运行视觉检查，不合并、不部署。

## 额外检查焦点

早于 lazy engine/GLB 完成的点选、切贴纸/清贴纸的 presentation 竞争、恢复时贴纸与锁定不变、门窗变换沿用 closed-pose chart、非目标材料与现有 eligibility 不变。自动测试不代替浏览器检查：1280/390 无溢出、全部切换/恢复和门窗动作、真实像素与反光条/车牌清晰度保持待验；不为这些检查启动受保护 dev/build 配置链。

## 安全边界

已核对测试将导入的 editor → wrap-layout / wrap-eligibility → three 和 i18n 均无私有文件读取；新增测试无 fs/网络读取。engine 只导入现有公开前端模块，测试不调用 constructor/load；不读取 `.openai/hosting.json`、`.env` 或身份文件。Node 24.19.0 满足版本要求。安装已获一次修正许可，成功后不再重复。

## 2026-10-28 续行与 engine 受控验证预案

本轮任务/run：`01a17e5b-6837-77ea-b6b3-581f511d8001` / `01a18339-131e-75df-98ea-364c9005826f`。维护者 15:54 UTC 批准，Issue 回执 6473856335 accepted、6473866535 running。原成果/规则/锁一致；原测试夹具仅补 `focus()`，3/3 绿。预先记录的恒零 uniform 故意破坏已得到唯一预期断言红（2/3），恢复后 3/3 绿。

下一受控正常红：新增 engine 测试用真实 `SceneEngine.prototype`，只提供 camera/controls/grid/renderer 读状态需要的内存边界，不创建 WebGL 或调用 load/fetch。先断言 `setPalette` 存在；当前应仅此断言失败（已有 3 项仍绿）。实现 setter 后验证待加载选择保留、材质模式、现有 editor 转发及清贴纸时配色仍显示。加载后的实际恢复由 load 内转发和 VehicleScene onReady 重放实现，真实 GLB/浏览器异步时序仍列未运行，不能把 prototype 单测写成真实加载通过。
