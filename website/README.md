# A股盯盘产品官网

这是插件的独立静态推广页，不参与 VS Code 扩展运行时。

## 本地预览

在 `website` 目录启动任意静态服务器，例如：

```powershell
python -m http.server 4173 --directory .
```

然后打开 <http://127.0.0.1:4173/>。

页面使用原生 HTML、CSS 和 JavaScript，包含粒子连线、分时行情动效、滚动入场、鼠标 spotlight、轻微 3D 卡片倾斜和移动端导航。`assets/` 中的截图来自插件实际界面。

“结构”入口会打开独立的 `dashboard.html` 数据看板。官网首页只保留看板入口，完整的股价/股东户数趋势、股票搜索和时间范围切换都在独立看板中展示。

## 股东结构趋势数据

网站的数据分成两层：

- `data/retail/universe.json`：由 `scripts/collect-stock-universe.mjs` 从东方财富 `push2.eastmoney.com/api/qt/clist/get` 分页生成，包含全部 A 股的名称、代码、市场和最新行情快照，用于搜索。
- `data/retail/index.json`：由 `scripts/collect-retail-data.mjs` 生成，包含已配置股票的股东户数历史、日 K 线、最新报价和原始接口 URL。默认配置目前为 600900、000001、300750；其他股票在搜索中会显示“趋势数据待采集”。

`.github/workflows/retail-data.yml` 在工作日定时刷新目录和趋势数据，也可以在 GitHub Actions 中手动运行。要增加完整趋势采集对象，编辑 `data/retail/stocks.json` 后重新运行采集脚本。

页面中的“股东户数代理 R”严格按以下公式计算：`H = 股东户数`、`I = 可识别机构账户`、`C = 可识别法人账户`、`T = 前十大可识别非散户账户`，`R = max(0, H − I − C − T)`，代理占比为 `R / H`。当前公开接口没有完整的机构/法人账户明细，因此扣除项通常为 0，结果标为 C 级代理值；它不是实际散户人数。页面会显示每个字段的实际值、统计截止日、披露日、覆盖范围、采集状态以及股东户数、历史 K 线和最新报价的原始接口链接。相关系数只描述历史同步关系，不代表因果关系。
