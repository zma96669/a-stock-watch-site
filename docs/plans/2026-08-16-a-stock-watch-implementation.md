# A 股盯盘 VS Code 扩展实施计划

日期：2026-08-16

关联设计：`docs/plans/2026-08-16-a-stock-watch-design.md`

## 阶段 1：项目骨架与测试基线

1. 创建 TypeScript VS Code Extension 项目。
2. 配置 `package.json`、`tsconfig.json`、esbuild、ESLint 和测试命令。
3. 创建扩展激活入口 `src/extension.ts` 与停用清理入口。
4. 配置 VS Code Extension Test Runner，并加入一个扩展可激活的烟雾测试。
5. 添加 `.gitignore`、README 初稿和开发命令说明。

验收：依赖安装成功，构建、单元测试和扩展宿主烟雾测试通过。

## 阶段 2：领域模型与东方财富 Provider

1. 在 `src/domain/types.ts` 定义股票、报价、分时点、行情快照和 Provider 接口。
2. 在 `src/market/stock-code.ts` 实现六位代码验证及沪深 `secid` 转换。
3. 先为字段映射、价格缩放、空数据和停牌数据编写测试夹具。
4. 在 `src/market/eastmoney-provider.ts` 实现批量报价和单股当日趋势请求。
5. 增加超时、AbortSignal、响应结构校验和可读错误类型。

验收：全部解析测试通过；用一个显式手工命令验证真实接口，但自动测试不依赖公网。

## 阶段 3：统一状态和刷新调度

1. 在 `src/state/watchlist-store.ts` 使用 `globalState` 保存自选股。
2. 在 `src/state/current-stock-store.ts` 保存和广播当前股票。
3. 在 `src/services/quote-service.ts` 实现单一行情缓存和订阅机制。
4. 实现默认 5 秒刷新、请求防重入、超时和 5/10/20/30 秒退避。
5. 增加交易时间判断和非交易时间降频。
6. 使用假时钟和 Mock Provider 测试调度、失败和恢复。

验收：无重复请求；多个订阅方获得同一快照；失败不会清空最近有效数据。

## 阶段 4：侧边栏、状态栏和命令

1. 在 `src/views/watchlist-tree.ts` 实现自选股 TreeView。
2. 在 `src/controllers/status-bar-controller.ts` 实现当前股票状态栏。
3. 在 `src/commands/` 实现添加、删除、上一只、下一只和打开图表命令。
4. 添加股票时先调用 Provider 验证代码并获取名称。
5. 在 `package.json` 注册活动栏、视图、命令、菜单和配置。

验收：能完整完成添加、切换、删除流程，所有显示同步且红涨绿跌。

## 阶段 5：稳定分时图面板

1. 在 `src/views/chart-panel.ts` 创建官方 Webview Panel。
2. 将图表运行时代码置于 `media/chart/`，随扩展本地打包。
3. 绘制价格线、均价线、昨收线和成交量。
4. 支持悬停提示、窗口缩放、主题变化和面板恢复。
5. 设置严格 CSP、nonce 和本地资源白名单。
6. 添加 Webview 消息协议类型与序列化测试。

验收：面板可拖到右侧或底部；切换股票与每次刷新均增量更新，无 CDN 请求。

## 阶段 6：背景数据桥接

1. 在 `src/background/bridge-server.ts` 创建仅监听 `127.0.0.1` 的只读服务。
2. 使用随机令牌路径暴露状态快照和事件流。
3. 处理端口冲突、扩展停用、客户端重连和响应 CORS/CSP 边界。
4. 验证局域网地址不能访问，非令牌路径返回拒绝。
5. 为桥接服务编写端口和访问控制测试。

验收：背景消费者可实时获得当前股票和统一行情；服务只对本机有效并可干净停止。

## 阶段 7：实验背景注入

1. 在 `src/background/installer.ts` 实现 VS Code 安装位置发现和版本检测。
2. 注入前创建备份、记录哈希和注入版本。
3. 在 `media/background/loader.js` 创建 Canvas、监听编辑器 DOM、主题和尺寸变化。
4. 在 `media/background/background.css` 实现透明层级、代码可读性和 `pointer-events: none`。
5. 注册启用、关闭、修复背景模式命令。
6. 文件哈希不一致时停止恢复，绝不覆盖未知版本文件。
7. 为路径判断、哈希、补丁幂等性和恢复逻辑编写测试。

验收：启用后重载窗口可显示当前股票背景；关闭可恢复；失败不影响稳定模式。

## 阶段 8：完整验证与交付

1. 在深色、浅色主题测试。
2. 测试左右/上下分栏、多个编辑器、窗口缩放和高 DPI。
3. 模拟断网、超时、无效字段、停牌、端口占用和只读安装目录。
4. 连续运行至少一个交易时段，观察内存、CPU、定时器和请求数量。
5. 完善 README：安装、自选股、命令、配置、风险、背景恢复和卸载步骤。
6. 生成 VSIX 并在干净的 VS Code 配置中安装验证。

验收：构建和测试全部通过，稳定模式可独立使用，实验模式可以安全启停，VSIX 可安装。

## 开发顺序原则

- 每个阶段先写失败测试或固定测试夹具，再实现功能。
- 每个阶段独立提交，保持可回退。
- 在稳定模式完整通过前不开始修改 VS Code 工作台文件。
- 背景注入始终保持可选，任何失败不得阻塞扩展激活。
