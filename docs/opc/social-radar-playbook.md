# 拉花全社媒雷达 Playbook（方法说明）

> 本文件只记录雷达的方法与规则，不含运行结果。实时需求池见 `demand-pool.md`（快照，见文末说明）。
> 运行节奏：每周二、六 08:30（北京时间），增量采集，只找车身拉花 / 车贴 / 改色膜相关的真实用户痛点与隐藏机会点。

## 服务对象

van-sticker-studio：上传/生成图案 → 3D 预览 → 编辑拉花 → 保存方案 → 施工/合规评估。

## 覆盖范围（每轮全部尝试，并如实标注结果）

- 国内：小红书、抖音、Bilibili、微信生态（公众号文章、视频号公开内容、被搜索引擎索引的转发/讨论）
- 海外：Instagram、YouTube、Facebook、X (Twitter)
- 盲区（必须如实标注，不声称抓到）：朋友圈为私域，只能靠用户转发入库；抖音/小红书站内有登录墙与反爬，只能拿公开索引部分。

## 工具路线

- social.search：Instagram / Facebook / Threads
- browser.search：YouTube、Bilibili、X、被索引的小红书/抖音/微信内容
- facebook-cli（已连接用户账号）：Facebook 兴趣群
- 不登录任何平台账号，不绕登录墙/反爬，不编造链接，只收工具真实返回的 URL。

## Facebook 兴趣群特关（每轮必做）

- 找群：`groups search --keywords` 逐个检索三类主题词——车美容（car detailing / auto detailing）、车拉花（vehicle wrap / car wrap / vinyl wrap）、车贴纸（vinyl decals / car stickers），加繁体词（汽車美容、汽車貼膜、車體包膜、車貼）与房车组合词（RV wrap、campervan wrap、vanlife wrap、RV decals）。
- 看群：对新发现或高相关群跑 `groups details`，记录群名、链接、成员数、公开/私密、简介；私密群帖子只有账号是成员时才读得到，读不到如实标注，不申请加群、不冒充成员。
- 挖帖：对可读群跑 `groups posts --query`，痛点词：peeling / bubbles / fading / cost / regret / removal / 起泡 / 翹邊 / 價格 / 後悔 / 撕除。
- 追踪群清单不写入本仓库（涉及私密群 membership），只在每轮同步报告里单列新增/变化的群。

## 检索词（中英双语，每轮可轮换）

中文：房车拉花、车身拉花设计、车拉花 后悔/避坑/翻车、拉花 起泡 翘边 褪色、改色膜 痛点、车贴 备案 年检、拉花 30%、DIY车贴、宿营车/床车 美化、拉花 价格 被坑
英文：RV decal / campervan wrap design, vehicle wrap problems, vinyl wrap peeling / bubbles / fading, wrap vs paint, van wrap cost, DIY wrap fail, RV wrap ideas

## 聚焦过滤（只收拉花直接相关）

设计选型难、预览与实物落差、施工翻车（起泡/翘边/对位）、耐久/褪色、撕除伤漆、价格不透明、备案/年检/合规焦虑、保值影响、DIY 门槛、模板/风格灵感缺口。通用房车痛点（水电/停车/温控）不收。

## 入库规则

- 按原帖 URL 与痛点摘要去重，已有的不重复收；编号连续（P1 起）。
- 条目字段：编号 | 日期 | 平台 | 原帖链接 | 痛点摘要（一句话，注明用户原声还是媒体转述）| 相关性（高/中/低，高=直接影响拉花产品）。
- 机会点与产品修改建议：每轮最多 3 条，按优先级排，带证据（原帖链接/出现频次）；建议只写进同步报告，不直接改代码、不直接改产品文档，等维护者拍板。

## 发布流程（2026-10-26 维护者拍板）

- 每轮 top 建议（最多 3 条）进 van-sticker-studio 仓库 issue，标题格式 `雷达建议：<一句话>`，开前按标题去重。
- 需求池与素材库每周同步一次（周六轮次），以同步 PR 形式进仓库，合并由维护者点。
- 本仓库内的 demand-pool.md 与 decal-material-library.md 为快照；雷达每轮仍向工作区实时版本追加。
- 素材库全部条目授权未确认，商用须授权或重绘；需求池条目均为公开帖原声或转述，不含私人信息。
