# pi-calm

让 pi 的终端对话更安静、更有条理：

- **回答格式**：往 system prompt 里加入 Codex 风格的写作要求（先给结论、分点、`path:line` 引用、不复述代码、说明验证了什么）。
- **工具调用一行显示**：read / bash / edit / write / grep / find / ls 每次调用只占一行，显示状态、目标和几个关键数字。
- **折叠探索**：连续的 read / grep / find / ls 合并成一行 `Explored`。
- **不刷屏**：bash 运行时只更新一行（转圈 + 计时 + 最新一行输出）；失败时自动展开最后几行；`ctrl+o` 查看完整输出。
- **区分过程和结论**：过程说明显示成引用（`│`），最终回答前加 `●`。只影响显示，模型看到的内容不变。

```
│ 先看一下测试为什么失败
✓ ◇ Explored · read src/config.ts · grep "parseConfig"
✗ ❯ bash npm test · 2.3s · exit 1
    expected 3, received undefined
✓ ✎ edit src/config.ts · +4 −1
✓ ❯ bash npm test · 2.1s

● 修好了。问题在 src/config.ts:42 ……
```

## 安装

```sh
pi install git:github.com/woertedetiankong/pi-calm     # 或者只试一次：pi -e git:github.com/woertedetiankong/pi-calm
```

从本地目录安装：`pi install /path/to/pi-calm`，或 `pi -e /path/to/pi-calm/index.ts` 只在本次运行加载。

## 使用

装上就生效，没有命令也没有配置。工具摘要里的文字（"120 行" / "120 lines"）会跟随你提问用的语言。想看某次调用的完整输出，按 pi 自带的 `ctrl+o`。

建议同时在 pi 设置里打开 `hideThinkingBlock: true`：思考过程只剩一行标签，探索调用也能跨思考块折叠。

## 说明

- 插件会以同名重新注册内置工具，执行逻辑仍然是 pi 自带的实现（保留 `shellPath`、`shellCommandPrefix`、图片缩放等设置），只替换显示方式。如果别的扩展也覆盖了这些工具，后加载的那个生效。
- grep / find / ls 保持 pi 的默认设置，不会因为装了这个插件而被启用。

## 开发

```sh
npm install
npm run check   # tsc
npm test
```
