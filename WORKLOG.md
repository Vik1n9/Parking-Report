# 工作進度紀錄

## 2026-06-18

- 依使用者核准計畫新增保全手機回報入口 `guard.html`，保全頁專注手機操作，不規劃桌面版。
- 新增共享核心 `parking-core.js` 與 `parking-core.test.js`，涵蓋固定區域順序、LINE 易讀版、中控口播、Excel 值與車塔使用率。
- 保全頁採頁面內建 `0~9` 數字鍵盤，支援車位連續輸入、成數輸入、台車模式、上一格/下一格、未停車與清除本格。
- 保全頁新增「分享到 LINE」與「複製 LINE 回報」，歷史紀錄使用獨立 key `parking_guard_history_v1`，避免與中控頁混用。
- README 保留中控頁與保全頁入口連結；依現場安全需求移除 `index.html` 與 `guard.html` 的彼此切換連結，避免誤入錯頁。
- README 的入口連結改為 GitHub Pages 線上網址，避免從 GitHub README 點擊時開到 HTML 原始碼檢視頁。
