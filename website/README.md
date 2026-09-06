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

`data/retail/index.json` 由仓库根目录的 `scripts/collect-retail-data.mjs` 生成。`.github/workflows/retail-data.yml` 会在工作日定时更新，也可以在 GitHub Actions 中手动运行。要调整网站默认展示的股票，编辑 `data/retail/stocks.json` 后重新运行采集脚本。

页面中的“散户估算代理”以公开股东户数为基础；缺少完整机构账户明细时，估算值会等于股东户数并标为 C 级代理值。它不是实际散户人数，相关系数也不代表因果关系。
