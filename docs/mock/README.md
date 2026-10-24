# 文档配图源文件

`docs/images/` 里的截图不是手工 P 的，而是**用扩展真实的 `content/app.css` + 真实的 DOM 结构**渲染出来，再用 Chrome 无头模式截的。这样界面一改，重截一次就同步了，不会出现「文档里的图和实际长得不一样」。

| 文件 | 说明 |
|---|---|
| `mock.css` | 模拟的 BOSS 职位列表页背景（与原平台无关，仅作氛围） |
| `icons.js` | 把 `content/app.js` 里的线性图标原样注入 `[data-ic]` 占位元素 |
| `panel-home.html` | 首页：统计 / 开始按钮 / 筛选条件 / 投递日志 / 运行日志 |
| `panel-settings.html` | 设置页：活跃状态 / 偏好 / 招呼语 / 聊天与简历 / 图片 |
| `panel-data.html` | 数据统计：近 7 日柱状图 / 状态分布 |
| `chrome-extensions.html` | 扩展管理页安装示意（示意图，非真实截图） |

## 重新生成

面板类页面支持 `?scroll=480` 参数，把面板内部滚动到指定位置，方便一张图截「上半」一张图截「下半」。

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
BASE="file:///$(pwd)/docs/mock"

"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1280,880 --virtual-time-budget=3000 \
  --screenshot="$PWD/docs/images/panel-home.png" "$BASE/panel-home.html"

"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1280,880 --virtual-time-budget=3000 \
  --screenshot="$PWD/docs/images/panel-log.png" "$BASE/panel-home.html?scroll=560"

"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1280,880 --virtual-time-budget=3000 \
  --screenshot="$PWD/docs/images/panel-settings.png" "$BASE/panel-settings.html"

"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1280,880 --virtual-time-budget=3000 \
  --screenshot="$PWD/docs/images/panel-settings-2.png" "$BASE/panel-settings.html?scroll=520"

"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1280,880 --virtual-time-budget=3000 \
  --screenshot="$PWD/docs/images/panel-data.png" "$BASE/panel-data.html"

"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1024,338 --virtual-time-budget=2000 \
  --screenshot="$PWD/docs/images/install-chrome.png" "$BASE/chrome-extensions.html"
```

`panel-log` / `panel-settings` / `panel-settings-2` / `panel-data` 四张在截完后裁掉了左侧多余的页面区域（保留 `760,190 → 1280,880`），只留面板 + 一点背景。

## 为什么不用真机截图

真机截图会带上真实公司名、真实 HR 名称、账号昵称和头像 —— 这些一旦进了公开仓库就收不回来。用同款样式复现，既能保证视觉一致，也不会泄露任何真实数据。
