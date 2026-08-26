# hololive Dreams 隊伍最佳化

在瀏覽器裡計算 hololive Dreams 的隊伍組合。沒有伺服器、沒有帳號——所有運算都在你的裝置上完成，庫存只存在瀏覽器裡。

**https://holodream-tools.github.io/hololivedream-optimizer/**

## 功能

| 分頁 | 用途 |
|---|---|
| 卡片庫 | 全部卡片的能力值與技能敘述，可切換命座比較 |
| 我的卡片 | 設定持有、命座、Leader Outfit；可匯出／匯入 |
| 自選隊伍 | 自己挑五張，看推薦指數如何組成 |
| 隊伍最佳化 | 窮舉所有組合，可指定必須上場的卡 |
| 歌曲／順序 | 指定譜面的 Perfect-FC 預估分與最佳站位 |

## 這個數字是什麼

「推薦指數」是**隊伍之間的相對比較值**，不是遊戲畫面上的分數：

```
推薦指數 = 加成後總合力 × (1 + Active 期望倍率)
```

模型的兩個關鍵假設：Score Support 沒有獨立分數，只在 Active 生效時放大它；泛用模式的 Special 以 192 秒參考長度做時間平均。實際分數請用「歌曲／順序」，那裡用的是公開譜面的真實時間點。

Board、Connect、Memory、Fever 與玩家失誤都不在模型內。

## 計算怎麼跑的

搜尋是窮舉的，沒有啟發式剪枝——66 張卡 × 66 個 Outfit 是 5.9 億次評估。工作依組合索引切成連續區段分給 Web Worker，各自維護區域 Top-N 再合併。排序鍵是 `(分數, -列舉序)`，所以分數相同時保留較早列舉到的項目，結果與分片方式無關。

## 資料來源

卡片數值與技能來自 [konono/holodreams_solver](https://github.com/konono/holodreams_solver)（MIT），開啟頁面時直接向上游取得，所以新卡不必等重新部署。取得失敗時退回打包時的快照。

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

資料由 [hololivedream_optimizer](../hololivedream_optimizer)（Python）匯出。把兩個專案放在同一層，或設定 `HOLODREAM_PROJECT`：

```bash
python3 tools/export_data.py       # 卡片、Leader Outfit、譜面
python3 tools/export_portraits.py  # 成員立繪對照表
python3 tools/export_images.py     # 本機卡圖（離線開發用，不進版本庫）
```

### 對照測試

TypeScript 引擎是 Python 實作的移植，由夾具測試釘住兩者：

- `overallScore` 與 `evaluate_team` 逐位元相同（400 組，涵蓋全部 8 種 Passive 效果類型）
- 分片後的 Top-N 與序列參考完全一致（夾具刻意含 28 組同分項目）
- 譜面分數跨 78–2022 音符全範圍相符

夾具由 `tools/export_truth.py`、`export_topn.py`、`export_chart_truth.py` 產生。測試失敗代表兩份實作已經分岔，不應該部署。

## 免責

非官方工具，與 COVER／QualiArts 無關。所有數值為公開資料的模型估計，不是官方保證值。
