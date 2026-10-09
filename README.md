# 掘金沸点 VSCode 扩展

在 VSCode 中浏览掘金沸点，查看沸点详情、评论和回复。

## 功能

- 浏览最新/热门沸点，滚动到底部自动加载更多
- 查看沸点详情和完整评论（含回复）
- 评论支持按最新/最热排序
- 行内展开评论，一次性加载全部评论和回复
- 图片显示开关（一键隐藏/显示所有图片）
- 一键刷新

## 安装

### 方式一：从 VSIX 安装

1. 下载或自行打包生成 `juejin-pins-0.2.0.vsix`
2. 按 `Ctrl+Shift+P` 打开命令面板
3. 搜索 "Install from VSIX"
4. 选择 `.vsix` 文件安装

### 方式二：从源码运行

1. 克隆仓库

```bash
git clone https://github.com/i-shl/juejin-pins-vscode.git
cd juejin-pins-vscode
```

2. 安装依赖

```bash
npm install
```

3. 编译

```bash
npm run compile
```

4. 按 `F5` 启动扩展开发宿主进行调试

## 打包

需要先全局安装打包工具：

```bash
npm install -g vsce
```

然后打包：

```bash
vsce package
```

会在项目根目录生成 `juejin-pins-0.2.0.vsix` 文件。

## 使用

1. 按 `Ctrl+Shift+P` 打开命令面板
2. 输入 "打开掘金沸点" 并回车
3. 在打开的面板中浏览沸点、切换最新/热门、查看评论

## 技术栈

- TypeScript
- VSCode Extension API (Webview)
- Node.js fetch (调用掘金 API)
