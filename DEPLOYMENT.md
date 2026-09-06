# 网站部署说明

## GitHub Pages

仓库 `zma96669/a-stock-watch-site` 的 `Deploy website` 工作流会在 `main`/`master` 分支变更网站文件时运行。部署步骤会先执行：

```powershell
node scripts/collect-stock-universe.mjs
node scripts/collect-retail-data.mjs
```

这样 Pages 构建产物会同时包含完整 A 股搜索目录 `website/data/retail/universe.json` 和已配置股票的趋势快照 `website/data/retail/index.json`。访问地址：

<https://zma96669.github.io/a-stock-watch-site/dashboard.html>

## 本地预览

在插件仓库执行：

```powershell
node scripts/collect-stock-universe.mjs
node scripts/collect-retail-data.mjs
python -m http.server 4173 --directory website
```

然后打开 <http://127.0.0.1:4173/dashboard.html>。必须通过静态服务器访问，直接双击 HTML 可能被浏览器的 `file://` 跨域策略拦截 JSON。

## 数据口径

搜索目录来自东方财富公开行情目录接口，趋势数据来自东方财富股东户数报表、历史日 K 线和最新报价接口。看板会区分“已采集趋势”和“仅目录快照”，并在数据明细区展示公式、实际字段值、截止日期、覆盖范围和原始接口链接。股东户数代理值不是实际散户人数，也不构成投资建议。
