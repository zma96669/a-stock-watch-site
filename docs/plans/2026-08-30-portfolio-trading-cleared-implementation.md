# 持仓买卖流水与清仓记录实施计划

关联设计：`docs/plans/2026-08-30-portfolio-trading-cleared-design.md`

## 阶段 1：模型与 PortfolioStore

1. 在 `src/domain/types.ts` 增加交易方向、交易记录、持仓汇总、清仓汇总和投资组合数据类型。
2. 新增 `src/state/portfolio-store.ts`，实现加载、校验、旧持仓迁移、买入、部分卖出、清仓归档、交易记录读取和删除。
3. 用加权平均成本计算当前成本和已实现盈亏；每次写入同步更新 `WatchlistEntry.costPrice/shares` 以兼容旧 UI 和行情服务。
4. 为买入/卖出边界、迁移和多持仓周期写单元测试。

## 阶段 2：导入导出与云同步

1. 扩展便携备份格式，加入投资组合数据并保持旧备份可解析。
2. 扩展导入事务，同时写入和回滚 Watchlist、当前股票与 Portfolio。
3. GitHub 合并按交易 ID、持仓周期 ID和清仓记录 ID 去重，保留较新记录。
4. 增加格式校验、数量上限和异常输入测试。

## 阶段 3：扩展入口与 Webview 消息

1. 在扩展激活时创建 PortfolioStore，并注入 Webview、TransferService。
2. 新增买入、卖出、查看交易记录和删除清仓记录命令/消息。
3. 股票菜单增加交易操作表单；卖出默认填入当前股数并校验不超仓。
4. 在状态 payload 中返回投资组合汇总、交易流水和清仓记录。

## 阶段 4：布局和滚动修复

1. 将 Webview 改为视口高度的 flex 布局，工具栏和顶部节点不使用互相覆盖的 sticky 偏移。
2. 持仓节点设定最大高度和内部滚动；普通分组与清仓放入独立 `stock-list-scroll`。
3. 将清仓树节点固定在普通滚动容器末尾，保持默认折叠和中性色样式。
4. 覆盖窗口缩放、窄侧栏、分组折叠、拖拽和滚动事件测试。

## 阶段 5：验证与交付

1. 执行 `npm run check`、`npm test`、`npm run build` 和 `npm run package`。
2. 升级版本，更新 README、官网文案和下载包。
3. 安装新版 VSIX，手工验证买入、部分卖出、清仓、重买和滚动行为。
4. 提交并推送插件与官网更新。
