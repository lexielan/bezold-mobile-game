# 誰有好眼力？Google Sheet 後台版

本版新增：
- 玩家端不顯示 CSV 下載按鈕。
- 遊戲結束後，server.js 會自動把研究資料送到 Google Sheet。
- 如果沒有設定 GOOGLE_SHEET_WEBHOOK，遊戲仍可正常玩，只是不會存後台。

部署步驟：
1. 覆蓋到 GitHub 專案。
2. GitHub Desktop commit / push。
3. Render Deploy latest commit。
4. 建立 Google Sheet + Apps Script。
5. 將 Apps Script Web App URL 設到 Render Environment Variable：
   GOOGLE_SHEET_WEBHOOK = 你的 URL
6. Render 重新部署一次。

Google Apps Script 程式在 GOOGLE_APPS_SCRIPT.txt。
