# MXGARAGE Wrap Studio

## 房车工作流开发文档（待评审扩展规格）

[项目开发入口](docs/development/README.md) 汇总无限画布、实时外观、空间布局、真实 AI 四图、版本 / 保存 / 导出与验收计划；[未决问题](docs/development/OPEN_QUESTIONS.md) 可按编号留言。该提案不改变现行治理规则或既有冻结验收，功能现状与目标已分开记录。

A private, interactive decal studio for a campervan 3D model.

## Use

The hero starts as a live engineering-style drawing of the actual vehicle on warm paper. Write a description and generate four options. Successful batches are ordered by design number and automatically apply the first successful option. Click any other card to apply it immediately to both vehicle sides. Four clearly labelled GPT Image sample decals are available before server AI is configured. Drag the vehicle to orbit, scroll to zoom, or use the five camera presets. Canvas keyboard controls: Left/Right to orbit, +/− to zoom, Home to return to the overview.

Click doors, glazing, the rooflight or awning to operate them. The control dock provides the same actions. “一键露营” opens parts in sequence; “收起全部” returns them to their closed poses. The 500 mm wipers sweep 180° in the same direction every five seconds, with overlapping coverage at the middle of the windshield. Reduced-motion preferences disable ambient movement and automatic wipers, and make part transitions immediate.

## Motion and feedback

Waiting adds staggered, small rooflight, window and entry-door movement on top of the user pose; cancelling or failing returns smoothly to that pose. Applying a design waits only for its image to decode and then displays the complete texture in place. It does not animate the camera, sweep the decal onto the body, show a title banner, or announce a success toast. The current camera and door/window poses stay unchanged. A failed next image leaves the existing sticker visible, and superseded requests cannot overwrite a newer choice.

Drawing edges are extracted across continuous paint surfaces within each motion parent. This removes false material-partition seams while keeping door hinges separate. A vehicle-only screen-space silhouette closes the smooth roof/body outlines without exposing tessellation. Structural lines use stronger ink than internal details, on a faint drafting grid. Flexible wipers render as thin dark geometry in drawing mode, without a second static outline.

Window glazing uses neutral 80% physical transmission with light surface reflections in material mode. Drawing mode uses a 20%-opaque white fill (80% transparent) so the cabin remains visible. Glazing does not cast opaque shadow-map silhouettes; changing presentation or applying a decal retains these glass settings.

Batch ordering, cancellation and camera takeover were verified in an isolated local browser with a test-only generation response. No test response is shipped as a production API fallback. Actual live generation still requires the server key.

## Server AI configuration

Configure `OPENAI_API_KEY` as a Sites server secret. Never use a `NEXT_PUBLIC_` variable for the key. `OPENAI_IMAGE_MODEL` is optional and defaults to `gpt-image-2`. The browser never receives the key. For local development, copy `.dev.vars.example` to the ignored `.dev.vars` and set values there.

`POST /api/generate` validates the description and sends four distinct art directions to OpenAI Images, with two requests in flight. It streams progress and transparent PNG results as NDJSON. Stop cancels outstanding requests and retains completed options. Partial results remain usable. Missing configuration and upstream failures are reported explicitly; sample images are never presented as live AI output.

Live paid image generation has not been exercised because the server key is intentionally pending configuration. The request/stream/error contract is covered with injected upstream responses.

## Vehicle

`public/model/mxgarage-rv.glb` was exported from the user's actual Blender model. The web copy excludes solar panels, rear luggage, rear rack and driver. The original body and accessory geometry is preserved; the verified custom 180° wipers are synchronized to the Blender master. The export retains the original doors, windows, interior and mirror geometry, with seven exterior wrap surfaces and named motion pivots. The vehicle has 317,087 triangles; the web GLB also carries calibrated wiper sweep poses.

`public/model/motion_metadata.json` defines axes, UV projection, hit regions and motion ranges. Entry door: 180°; cab doors: 65°; side windows: 25°; rooflight: 30°. Apart from the requested entry-door limit, these are visualization poses, not verified mechanical or fabrication specifications. Awning extension is an animated display rig. The web app applies decals to the browser model; it does not overwrite the Blender master file.

## Direct wrap editing

Hover a decal on the vehicle to reveal a surface-following marching-ant border and its upper-right tools. Drag the painted area or move handle to reposition it; drag the diagonal handle or use −/+ to scale. Each side can be adjusted independently. Dragging outside the decal still orbits the camera. Arrow keys on the move handle provide fine positioning; Escape or a cancelled touch restores the drag-start placement. Reset returns both copies to their initial layout.

The lock button at the right end of the decal toolbar locks both copies of the current graphic. Marching ants and editing tools disappear, and dragging over the graphic orbits the vehicle without changing placement. Right-click the graphic and choose “解锁拉花” to resume editing. The canvas keyboard menu shortcut (Shift+F10) is also supported. Escape or clicking outside dismisses the menu. Locking persists across view, presentation and design changes; clearing the graphic resets it.

The editor uses one continuous closed-pose perimeter chart for side/front/rear paint. Decals cross eligible body corners and follow moving doors. Glass, lights, grille, trim and interior are excluded, so the graphic is clipped at those surfaces; it does not reflow lettering around windows. Positions update through shader uniforms, without rebuilding/uploading full canvases while dragging. No Blender source geometry or GLB is changed.

## Plan insights

Applying a design opens a live **Plan insights** panel under the design list. It updates as you drag or scale the decal on the vehicle, and every figure is an estimate with its basis stated in the UI:

- **Coverage estimate** — the combined decal area on both sides against the paintable side area, shown against the **30% compliance line**. At or under 30% a decal usually needs no filing; above it, a change registration is due within 10 days.
- **Compliance card** — what the 30% line means in practice: under 30% vs over 30%, and how decals differ from a full color change (which also needs a new license photo above 30%). Local vehicle-office rules prevail.
- **Price estimate** — a reference price scaled from a full-vehicle color-change film anchor of CNY 3,000–8,000 (domestic film), split into film and labor, with the film usage including an edge/cutting waste factor. It is a reference estimate, not a quote; shops confirm final pricing.
- **Installation check** — a short pre-install self-check: paint history (factory vs respray), curves and edge wrapping, and removal risks stated up front.
- **Reversibility note** — decals remove cleanly within the film's lifespan (about 2–3 years, estimate) and protect resale value better than paint or a full color change; the resale figures shown are media-reported and labeled as such.

## Develop and verify

- `npm install`
- `npm run dev`
- `npm run lint` checks the authored application, renderer, API and tests; scaffold UI examples are unused.
- `npm test` checks generation, motion, batch ordering, GLB consistency, drafting boundaries and calibrated wiper clearance.
- `npx tsc --noEmit`
- `npm run build`

Browser acceptance covered selection → application, readable placement on both sides, door/roof/window/awning display poses, complete reset, missing-key feedback, invalid WebMCP inputs, and responsive layout. Four samples are included under `public/stickers/` and were created with GPT Image for this project.

## Structure

- `app/page.tsx`: visible workflow and state
- `lib/i18n.ts`: English/Chinese UI dictionary (`STRINGS` + `t()`), English by default
- `components/studio/scene-engine.ts`: Three.js renderer, hit tests and motion
- `lib/vehicle-wrap-editor.ts`: continuous surface decals, marching ants and direct gestures
- `lib/wrap-layout.ts`: perimeter mapping and placement bounds
- `lib/plan-insights.ts`: coverage and price estimate math behind Plan insights
- `components/studio/PlanInsights.tsx` with `CoverageMeter`, `ComplianceCard`, `PriceEstimateCard`, `InstallCheckCard` and `ReversibilityNote`: the Plan insights panel
- `components/studio/use-studio-tools.ts`: five page-defined WebMCP tools
- `lib/generation.ts`: server image generation and streaming
- `app/api/`: server-only routes
- `.openai/hosting.json`: existing owner-private Site identity

## 中文摘要

MXGARAGE Wrap Studio 是为厢式房车打造的交互式拉花工作台：写一句描述即可生成四款贴纸方案，并直接贴到可交互的 3D 车身上预览效果。界面默认英文，可一键切换中文。

方案洞察（Plan insights）五项特性：覆盖率估算（对照 30% 合规线）、合规说明卡、价格估算（参考价，按全车改色膜锚点折算）、施工评估自检、可逆与保值说明（含媒体口径保值率数据）。

本地运行：

- `npm install`
- `npm run dev`
- `npm test` / `npm run lint` / `npx tsc --noEmit`
