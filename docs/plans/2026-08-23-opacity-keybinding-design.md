# 背景透明度快捷键调整设计

## 目标

避免原来的 `Ctrl+Alt+Shift+,` 被 WPS 全局快捷键抢占，导致操作时唤醒 WPS。

## 方案

- `Ctrl+Alt+Shift+]`：提高行情背景清晰度
- `Ctrl+Alt+Shift+[`：降低行情背景清晰度

保持现有命令 ID 和透明度逻辑不变，只替换 VS Code manifest 中的快捷键，并同步更新贡献声明测试和使用说明。`Ctrl+Shift+N` 背景显示/隐藏快捷键不变。
