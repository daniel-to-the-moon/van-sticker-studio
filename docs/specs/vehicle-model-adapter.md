# 车型模型适配契约（#85 第一刀）

冻结版本：本文件随 `feature/85-vehicle-model-adapter` 提交。base 为 main `112f4a26b95cda32a077ceca3210282ff663fa2a`。未合入 main 前，不以本分支替换现行编辑器行为。

## 目标

把车身比例、轴向、原点和可贴/不可贴分类从当前车型里抽成可验证契约。适配器按契约给出稳定贴图坐标和显式反馈。`/model-lab` 用这套适配器和 `VehicleWrapEditor` 的真实贴画着色路径查看同一套文字、图标、色块设计。

## 非目标

- 不宣称任意未知模型已经全部支持。未登记网格一律显式反馈。
- 不替换生产 GLB，不改哈希，不改首页、`scene-engine`、`free-wrap.ts`、草稿保存或 `WrapDesignStudio.tsx`。
- 不把程序生成车体写成量产尺寸。
- 不把默认编辑器的车头漆面过渡扩大成「所有漆面都可贴」。

## 规范坐标

- 米。
- 车头为 −X，+X 朝车尾。
- +Y 向上，地面为 Y = 0。
- +Z 为驾驶侧，−Z 为入户侧。
- 周向坐标 `s` 与现行 `perimeterCoordinate` 一致：入户侧从车尾到车头，`s` 由 0 增至车长；驾驶侧从车头到车尾。
- 源坐标可以是米或毫米、非零原点、另一组右手轴向。适配前先变到规范坐标。左手轴向直接拒绝，避免镜像字形。

## 冻结类型

`lib/vehicle-model-profile.ts`：

- `SourceFrame`：`unit`（`m` | `mm`）、`rearward` / `up` / `driver`（带符号的源轴）、`origin`。
- `VehicleModelProfile`：`id`、`label`、`verification`、`frame`、`envelope`、`panels`、可选 `voids`。
- `VehiclePanel`：`class`（`wrap` | `glass` | `lamp` | `wheel` | `interior` | `trim`）、精确 `meshes`、`projection`、可选 `openings` 与 `motion`。
- 投影只允许四种：`perimeter`（周长面上的入户/驾驶/前/后）、`arc`（曲面顶的弧长）、`local`（阶梯、拓展舱等局部平面）、`unsupported`（写明原因）。
- `perimeter.shell` 只给当前 GLB 上已经登记、材质名以 `Wrap_` 开头的包覆壳。这些网格沿用现行周长坐标，保留已审计的浮雕。验证模型不设 `shell`，离开所声明平面或拉伸超限会拒绝。
- `PanelMotion`：`hinge` 或 `slide`。角度和距离都是相对闭合姿态。
- `LabDesign`：`version: 1`、文字、图标（`cup` | `runner` | `badge`）、色块、`x` / `y` / `scale`。编辑面 `x = 0` 在车头一侧。

`lib/vehicle-wrap-adapter.ts`：

- `adaptPoint(profile, mesh, world)` → 规范坐标、图坐标、着色器坐标、是否可贴、反馈。
- `adaptTriangle(...)` → 跨空隙、跨开口、内表面、退化面或拉伸超限时不可贴，并给出原因。
- `bakeWrapAttributes(mesh, profile)` → 写入 `aWrapCoord` / `aWrapEligible`，并返回真实覆盖反馈。每个三角形都走 `adaptTriangle`。开口或空洞被三角形完全包住时同样拒绝。全部拒绝的网格状态不是 `applied`。开口边界上的墙面顶点保留真实周长坐标。左右侧围按车长线性取坐标，避免径向周长映射在同一网格的 T 形接缝两侧错开。局部入户/驾驶面也按同一车长位置取侧围坐标。只有接缝或「拒绝三角形与合格三角形共用顶点」时才复制几何。
- `meshStats(root)` → 三角面数、绘制调用、退化面数。

`VehicleWrapEditor` 构造参数增加可选 `profile?: VehicleModelProfile`。

- 不传：仍走现行材质名、`findFrontWrapTransitions` 和 `perimeterCoordinate`。
- 传入：包络以 profile 为准；只有适配器判定可贴的顶点进入贴画；玻璃、灯、轮胎、内饰、饰件和未登记网格不写可贴属性。

## 贴画顺序

两侧共用同一编辑面：图标在文字左侧时，图标更靠近车头。入户侧图坐标与编辑面左右相反，只反射放置，不镜像字形（`mirrorGlyphs` 恒为 `false`）。这是 #74 里两侧可读、左右顺序与编辑面一致的规则。

## 反馈

| 状态 | 含义 |
| --- | --- |
| `applied` | 顶点落在已登记侧围域，可以进现有贴画着色器 |
| `excluded` | 面板已知，但本设计不贴：玻璃、灯具、轮胎、内饰、饰件、开口、曲面顶、阶梯/端面 |
| `unsupported` | 不能安全投影：未登记网格、左手系以外的坏投影、跨空隙假面、离开所声明平面、拉伸超限、退化面 |

不允许把这些面静默拉进同一个侧围矩形。

## 车型

| id | 说明 |
| --- | --- |
| `current-glb` | 当前 GLB 的兼容 profile。只登记材质名以 `Wrap_` 开头的网格。`verification: false` |
| `box-trailer` | 箱式/拖挂验证模型 |
| `high-roof` | 高顶曲面厢车验证模型 |
| `step-slide` | 阶梯额头与拓展舱验证模型 |

后三个 `verification: true`。页面必须标明验证模型，不写成量产尺寸。

## `/model-lab`

页面创建 `WebGLRenderer`，调用 `bakeWrapAttributes` 所在的 `VehicleWrapEditor`，并用 `setDesign` 走现行贴画着色器。设计可改文字、图标、色块和位置，保存/恢复为 `LabDesign` JSON。四个车型使用同一种前侧三分之四视角公式。

## 验收对照

- 米/毫米、右手轴向、非零原点：同一物理点的图坐标一致。
- 两侧图标比文字更靠近车头，字形不镜像。
- 玻璃、灯、轮胎、内饰、饰件不贴；开口和空隙不被三角形连成假面。
- 门闭合时与相邻车身图坐标连续；打开后完全在门板上的点世界坐标变了，图坐标不变。
- 拓展舱伸出后局部图坐标不变，且不跨空隙连到主厢。
- 曲面顶用弧长；硬套周长矩形时因拉伸或离开平面被拒绝。
- 同一 `LabDesign` 可序列化后在另一车型恢复编辑坐标。
- 不传 profile 时，现行周长坐标回归。
- 验证模型网格有索引和法线，退化面为 0，并报告面数与绘制调用。

## 适配下一辆车

1. 实测规范包络（米、车头 −X）。不要把示意尺寸写成量产数据。
2. 为每个网格指定唯一面板和投影。对不上周长平面的面用 `local`、`arc` 或 `unsupported`。
3. 玻璃、灯、轮胎、内饰、饰件单独分类。
4. 活动件写出闭合铰链或滑移。
5. 用 `adaptPoint` / `adaptTriangle` 看反馈，再在 `/model-lab` 用同一设计目视两侧。

## 回滚

revert 本分支提交即可。默认编辑器不传 `profile`，回滚前也不改变现有车型路径。

## 已知局限

- 可选 profile 不复现默认编辑器对 `RV_Static_Body_Paint` 车头过渡三角的扩面。那些三角保持在默认路径里。
- 当前网页 GLB 没有独立轮胎网格。轮胎规则只在出现对应面板时生效，不把「没有网格」说成「已经支持轮胎」。
- 侧围设计不覆盖曲面顶、阶梯额头和前后端面。这些面有坐标或明确排除原因，不会被拉进左右矩形。
- 体验目检由未参与实现的体验官在准确版本上做。本文件的截图只是实现者证据。
