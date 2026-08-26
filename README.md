# hololive Dreams 隊伍最佳化

在瀏覽器裡計算 hololive Dreams 的隊伍組合。不需要伺服器、不需要帳號——所有運算都在你自己的裝置上跑完，卡片庫存也只留在這台裝置的瀏覽器裡。

**https://holodream-tools.github.io/hololivedream-optimizer/**

## 功能

| 分頁 | 用途 |
|---|---|
| 卡片庫 | 全部卡片的能力值與技能敘述，可切換命座比較 |
| 我的卡片 | 設定持有、命座、Leader Outfit；可匯出／匯入 |
| 自選隊伍 | 自己挑五張，看推薦指數如何組成 |
| 隊伍最佳化 | 窮舉所有組合，可指定一定要上場的卡 |
| 歌曲／順序 | 指定譜面的 Perfect-FC 預估分與最佳站位 |

## 這個數字是什麼

「推薦指數」是**隊伍之間的相對比較值**，不是遊戲畫面上的分數：

```
推薦指數 = 加成後總合力 × (1 + Active 期望倍率)
```

模型有兩個關鍵假設：Score Support 本身不加分，只在 Active 生效時放大它；泛用模式的 Special 以 192 秒參考長度換算成時間平均。要看實際分數請用「歌曲／順序」，那裡用的是公開譜面的真實時間點。

Board、Connect、Memory、Fever 與玩家失誤都不在模型內。

## 計算怎麼跑的

搜尋是完全窮舉，沒有做任何剪枝——66 張卡 × 66 個 Leader Outfit 就是 5.9 億次評估。運算依組合索引切成連續區段交給 Web Worker，各自維護自己的 Top-N 再合併。排序鍵是 `(分數, -列舉序)`，所以分數相同時保留較早列舉到的那一組，結果不會因為切成幾份而改變。

## 資料來源

卡片數值與技能來自 [konono/holodreams_solver](https://github.com/konono/holodreams_solver)（MIT），開啟頁面時直接向來源端取得，所以出新卡不必等重新部署。取不到時就沿用打包當下的版本。

譜面來自 Holodori 的標準化資料，每首歌的除數取自 [Hololive Dreams Lab](https://dreams.wf-calc.net/simulator)。

卡片圖片與成員立繪皆為**引用原始發布位置**，本專案不含任何圖片檔。

## 開發

```bash
npm install
npm run dev        # 開發伺服器
npm test           # 與 Python 參考實作的對照測試
npm run build
```

### 重新產生資料

資料由 [hololivedream_optimizer](../hololivedream_optimizer)（Python）匯出。把兩個專案放在同一層目錄，或設定 `HOLODREAM_PROJECT` 指到它：

```bash
python3 tools/export_data.py       # 卡片、Leader Outfit、譜面
python3 tools/export_portraits.py  # 成員立繪對照表
python3 tools/export_images.py     # 本機卡圖（離線開發用，不納入版本控制）
```

### 對照測試

TypeScript 引擎是 Python 實作的移植，用對照資料把兩邊鎖在一起：

- `overallScore` 與 `evaluate_team` 逐位元相同（400 組，涵蓋全部 8 種 Passive 效果類型）
- 切分後的 Top-N 與單執行緒版本完全一致（對照資料刻意含 28 組同分的隊伍）
- 譜面分數跨 78–2022 音符全範圍相符

對照資料由 `tools/export_truth.py`、`export_topn.py`、`export_chart_truth.py` 產生。測試沒過代表兩份實作已經走偏，不該部署。

## 免責

非官方工具，與 COVER／QualiArts 無關。所有數值為公開資料的模型估計，不是官方保證值。
