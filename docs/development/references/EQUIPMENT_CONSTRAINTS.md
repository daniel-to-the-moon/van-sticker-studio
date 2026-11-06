# 设备容纳与安装：空调案例

研究快照：2026-10-27。本页是配件规则的数据来源提示，不是安装方案、采购推荐或通风 / 承载批准；接入某一具体型号时需重新核对当前厂家资料。

## 1. 为什么不能只检查外包盒

用户希望空调能嵌入吊柜。这对特定分体式室内机有依据，但不能推广为“房车空调一般都可以塞吊柜”。需要同时区分设备本体尺寸、安装包络、允许安装面、进出风、排水、检修、支撑以及关联外机。

| 类型 | 来源核实的边界 | 产品规则含义 |
| --- | --- | --- |
| 高位柜内分体室内机 | Cruise N Comfort VES ULTRA U/M 官方列出高位柜内 / 天花形式；室内蒸发器与其他系统组件分开 | 可建立吊柜中的独立设备子对象；不因此省略外机和安装包络 |
| 座椅下 / 低柜内风管机 | Dometic FreshWell FWX4 官方手册要求地板安装 | 可处于柜体空腔，但支撑安装面仍是地板，不能吸到吊柜 |
| 储物舱空调 | Truma Saphir compact 官方举例为座椅储物箱 | 风管向上送风不等于整机可装高位柜 |
| 顶置一体机 | Dometic FreshJet 系列安装手册针对车顶安装 | 另一种 roof mount，不按车内吊柜设备处理 |

高位柜内型仍要依据厂家手册处理水平姿态、回风与送风、冷凝水排出、检修和车外冷凝器。不能自行编造统一净距，也不能将“可放进空腔”显示为“允许安装”。

## 2. 建议规则字段（非已确认数据格式）

`modelId`、来源文档与版本、设备尺寸、安装包络、`mountTargets`、允许姿态、容纳槽、进 / 出风面、排水 / 检修面、关联组件、质量及支撑待核提示。

P0 可以使用一类基础白模表达体积与关系，但必须标候选 / 未指定型号；未具备型号依据时，不自动给出工程意义的绿色“安装通过”。父柜跟随关系和设备实际锚固关系应分别记录，柜体移动跟随不能替代承载验证。

首个空调白模究竟采用哪种形式仍见 [Q12](../OPEN_QUESTIONS.md#q12-空调的首个基础白模)。既有外观 Body Lab 的 roof `ac` 不能直接当作所有室内空调的默认规则。

## 3. 官方来源

- [VES ULTRA U/M 产品页](https://www.cruisencomfortusa.com/ves-ultra-um)、[官方规格与安装示意](https://static1.squarespace.com/static/574ddcb49f72667133223193/t/6843901a5a3e6b496a26646a/1749258276484/VES%2B%2BULTRA%2BCut%2BSheet-.pdf)、[官方安装手册](https://static1.squarespace.com/static/574ddcb49f72667133223193/t/65f4ac741770656af4adad5b/1710533750722/VES%2BUltra%2BInstallation-.pdf)。
- [FreshWell FWX4 官方产品页](https://www.dometic.com/en-gb/product/dometic-freshwell-fwx4-9620013224?v=9620013224)、[官方安装手册](https://media.dometic.com/externalassets/02-0206-020634-020634001_9620013224_109754.pdf)。
- [Saphir compact 官方产品页](https://www.truma.com/products/air-conditioning-systems/saphir/saphir-compact/)。
- [FreshJet 系列官方安装手册](https://media.dometic.com/externalassets/dometic-freshjet-3-series-15k_9600028600_107740.pdf)。

以上品牌仅用于技术来源归属，不是产品界面命名、合作背书或首版商品库选型决定。源资料不随本文重分发；产品对外仍遵循现有通用化规则。
