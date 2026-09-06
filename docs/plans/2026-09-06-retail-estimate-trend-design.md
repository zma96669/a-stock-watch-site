# 散户数量估算与股价趋势网站设计

日期：2026-09-06

## 目标

在现有产品网站中增加一个可追溯的 A 股“股东结构趋势”页面。用户输入股票名称或代码后，页面展示股价走势、股东户数、散户数量估算值及相关指标，帮助观察二者的历史同步关系。页面必须明确提示：散户数量是模型估算值，不是真实散户人数；相关性不代表因果关系。

## 数据口径

### 原始数据

- 股东户数、前十大股东及持股性质：优先使用上市公司定期报告、巨潮资讯网或交易所披露数据。
- 实时/历史价格、成交额、换手率：使用现有腾讯财经主源，东方财富作为备用。
- 每条记录携带 `asOf`、`source`、`sourceUrl`、`confidence`，不允许把不同日期的数据伪装成同一时点。

### 估算指标

基础口径：

```text
estimatedRetailAccounts = max(0, shareholderAccounts - identifiableInstitutionAccounts)
```

增强口径（数据完整时）：

```text
estimatedRetailAccounts = max(
  0,
  shareholderAccounts
  - identifiableInstitutionAccounts
  - identifiableCorporateAccounts
  - top10ShareholderAccounts
)
```

辅助指标：

```text
averageSharesPerAccount = tradableShares / shareholderAccounts
estimatedRetailRatio = estimatedRetailAccounts / shareholderAccounts
```

页面展示“估算口径”和“可信度”等级，禁止简称为“真实散户数”。

## 技术架构

采用 GitHub Actions 定时采集，GitHub Pages 静态展示：

1. `scripts/collect-retail-data` 按股票列表抓取公开披露数据和行情数据。
2. 采集器进行字段校验、日期排序、重复去除和异常值检查。
3. 生成 `website/data/retail/<code>.json` 及索引文件，提交到数据分支/仓库。
4. GitHub Pages 读取静态 JSON，不在浏览器直接请求第三方财经接口。
5. 失败时保留上次成功快照，并在页面显示最后成功时间和数据源状态。

首版允许配置股票代码列表，后续再增加网页端自选股管理。实时行情只用于当前价格卡片和短周期走势，股东户数趋势按披露日期绘制。

## 数据模型

```ts
interface RetailTrendPoint {
  code: string;
  name: string;
  asOf: string;                 // 披露或交易日期
  price?: number;
  shareholderAccounts?: number;
  identifiableInstitutionAccounts?: number;
  identifiableCorporateAccounts?: number;
  top10ShareholderAccounts?: number;
  tradableShares?: number;
  estimatedRetailAccounts?: number;
  estimatedRetailRatio?: number;
  averageSharesPerAccount?: number;
  source: 'cninfo' | 'exchange' | 'eastmoney' | 'tencent' | 'manual';
  sourceUrl?: string;
  confidence: 'A' | 'B' | 'C';
}
```

## 页面与交互

- 搜索框支持股票名称和六位代码。
- 顶部显示股票名称、代码、最新价格、涨跌幅、最新股东户数披露日期。
- 主图采用双 Y 轴：左轴为股价，右轴为股东户数/散户估算户数。
- 股东户数公布日使用垂直标记，并可悬浮查看来源和口径。
- 下方显示户均持股、散户估算占比、换手率和成交额。
- 支持 3 个月、1 年、3 年和全部区间切换。
- 相关分析区显示 Pearson 相关系数，同时显示样本数量和数据频率。
- 页面顶部固定风险提示：估算值、低频披露、相关性不等于因果性。

## 相关性计算

只对日期可对齐的样本计算 Pearson 相关系数。股东户数为季度数据时，使用最近一个已披露值映射到后续交易日，但图表中保留披露日期标记。样本少于 4 个时不计算相关系数，显示“样本不足”。不提供买卖建议。

## 错误处理与安全

- 接口超时、限流或字段缺失：记录错误，保留旧数据，不生成空数据覆盖。
- 股东户数为 0、负数或跳变超过阈值：标记异常并降低可信度，不参与默认相关性计算。
- 任何来源变更写入采集日志，页面展示最后成功采集时间。
- GitHub Actions 使用只读公开接口，不保存用户 Token；数据文件不包含个人持仓信息。

## 验证标准

- 对至少 3 只沪深 A 股生成有效历史数据。
- 每个趋势点均有日期、来源和可信度。
- 估算值不会小于 0，也不会大于股东户数。
- 价格与股东数据日期错位时，页面明确标注而不是静默插值。
- 无数据、接口失败、股票不存在时页面有可读错误提示。
- GitHub Actions 可重复运行，失败不会破坏上一版数据。
