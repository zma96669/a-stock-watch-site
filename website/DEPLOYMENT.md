# GitHub Pages 发布步骤

项目已经包含 `.github/workflows/pages.yml`，它会把 `website/` 自动发布为 GitHub Pages。

## 首次发布

1. 在 GitHub 创建仓库并推送当前项目到 `main` 分支。
2. 进入仓库的 `Settings → Pages`。
3. 将 `Build and deployment → Source` 设置为 `GitHub Actions`。
4. 打开 `Actions`，等待 `Deploy website` 完成。
5. 访问 GitHub 显示的 Pages 地址：

   `https://<用户名>.github.io/<仓库名>/`

下载按钮使用 `website/downloads/a-stock-watch-0.1.36.vsix`，因此部署后即可直接下载当前版本。以后发布新版本时，替换该文件并同步修改页面版本号即可。

网站的“股东结构”模块由 `.github/workflows/retail-data.yml` 定时采集并提交 `website/data/retail/index.json`。首次发布后可在 Actions 页面手动运行该工作流，确认数据文件已更新；随后 Pages 工作流会自动重新部署。

部署后可直接访问 `https://<用户名>.github.io/<仓库名>/dashboard.html` 打开独立结构趋势看板；首页顶部的“结构看板”和首页入口卡片也会跳转到这里。
