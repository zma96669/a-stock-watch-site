# GitHub Pages 发布步骤

项目已经包含 `.github/workflows/pages.yml`，它会把 `website/` 自动发布为 GitHub Pages。

## 首次发布

1. 在 GitHub 创建仓库并推送当前项目到 `main` 分支。
2. 进入仓库的 `Settings → Pages`。
3. 将 `Build and deployment → Source` 设置为 `GitHub Actions`。
4. 打开 `Actions`，等待 `Deploy website` 完成。
5. 访问 GitHub 显示的 Pages 地址：

   `https://<用户名>.github.io/<仓库名>/`

下载按钮使用 `website/downloads/a-stock-watch-0.1.34.vsix`，因此部署后即可直接下载当前版本。以后发布新版本时，替换该文件并同步修改页面版本号即可。
