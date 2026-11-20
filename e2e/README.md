# e2e：关键路径与前后截图

由 `.github/workflows/e2e.yml` 在每个 PR 和 main 推送上运行；本地一般不用跑。

- `key-paths.spec.mjs`：浏览器关键路径（3D 就绪、AI 未配置时诚实不可用、样例贴到车身、`/design`、`/body-lab`、`/model-lab`、390px、请求不出站、无未捕获异常）。每步先截图再断言。
- `compare-shots.mjs`：无依赖的 PNG 对比，输出差异图、`summary.md`、`result.json`。单测在 `tests/compare-shots.test.ts`。
- `playwright.config.mjs`：软件 WebGL（SwiftShader）、1440×900、UTC、en-US。

本地跑法（需要能装依赖的环境）：

```bash
npm ci && npm run build
npx wrangler dev --config dist/server/wrangler.json --port 8787 &
mkdir -p /tmp/pw && cp e2e/playwright.config.mjs e2e/*.spec.mjs /tmp/pw/ && cd /tmp/pw
npm init -y >/dev/null && npm i @playwright/test@1.63.0 && npx playwright install chromium
E2E_SHOTS=/tmp/shots npx playwright test -c playwright.config.mjs
```

截图结论只是证据：有变化时由体验官看图后打 `visual-accepted`，没有变化时工作流自动打 `no-visual-change`。两个标签决定自动上线闸门是否放行（见 `docs/releases/README.md`，#107）。
