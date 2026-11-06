# PR #17 截图说明

Claim：`vss-17-lulu-20261025-01`。分支：`feature/17-generation-availability`。基线 main：`20aee5d1136bcfbec9b2a992aa5fbdfa25ff9eaf`。精确 head SHA 写在 PR 描述里。

这四张图只作界面证据，不是产品代码。拍摄时提示词区已展开，四张都是 1440×900，同一页、同一段示例提示词（139 字）。没有读取 `.dev.vars`，没有配置密钥，没有发出 `POST /api/generate`（拦截计数为 0）。

`/api/status` 在本地浏览器里被替换成内存响应，不代表线上密钥是否已配置（该项仍是 `[NEEDS CLARIFICATION]`）：

1. 第一次响应 `{configured:false}`，拍 `disabled-en.png`、`disabled-zh.png`。按钮为禁用，提示词仍在。英文文案是 “AI design is currently unavailable. Try a sample.”，中文文案是 “AI 设计暂不可用，先试试样例”。
2. 窗口重新获得焦点后，下一次响应 `{configured:true}`，拍 `recovered-zh.png`、`recovered-en.png`。按钮变为可点，提示词仍是同一段。

无头 Chrome 里的车身画面不是这次改动的对象。对比的是左侧生成区和状态文案。
