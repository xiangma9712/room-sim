# Room-Sim (3D インテリアシミュレーター + MCP サーバー)

ブラウザでリアルタイムに動く **Three.js 3Dルームシミュレーター** と、AIエージェントから複数部屋の管理・家具配置・配色・動線チェックを直接操作できる **MCP (Model Context Protocol) サーバー** です。

## 特徴
- **複数部屋の独立保存 (`data/rooms/<room_id>.json`)**: 部屋ごとに間取り寸法・開口部・柱やカウンターなどの室内構造・家具リストを独立して保存（`.gitignore` により個人データはリポジトリから除外）。
- **豊富な3Dプロシージャル家具カタログ**: ローベッド・ベビーベッド・ベビーサークル・昇降デスク＋ウルトラワイドモニター・ダイニングベンチ・キッチンカウンター・TVボード・ソファ・観葉植物などを収録。
- **壁沿い自動スナップ配置 & 動線・干渉チェック (`analyze_layout`)**: 壁からのはみ出し、柱・室内構造との干渉、家具同士の重なり、開き戸の開閉ゾーン干渉、通路幅、床面積占有率（%）を自動計算。
- **リアルタイム双方向同期 (SSE)**: AIがMCP経由で変更するとブラウザの3D画面が即座に更新され、ブラウザ側でドラッグ移動した変更も即座にAI側へ共有されます。

---

## 起動方法 (`mise` 管理)

```bash
# 1. ランタイム準備
mise install

# 2. 3D Webシミュレーター起動 (http://localhost:8765)
mise run dev

# 3. 保存済み部屋一覧の確認
mise run rooms

# 4. アクティブな部屋のレイアウト診断
mise run check
```

---

## MCP サーバー登録設定

Claude Desktop / Cursor / Antigravity 等の MCP 設定ファイルに以下を追加してください：

```json
{
  "mcpServers": {
    "room-sim": {
      "command": "mise",
      "args": ["-C", "/Users/shoma/Projects/room-sim", "run", "mcp"]
    }
  }
}
```

---

## 提供される MCP ツール一覧

| ツール名 | 説明 |
| :--- | :--- |
| `list_rooms` | 保存されている部屋一覧と現在アクティブな部屋IDを取得 |
| `switch_room` | 操作・表示対象のアクティブな部屋を切り替え |
| `create_room` | 新しい部屋を作成・保存（間取り寸法・開口部・柱やカウンター等の構造物を指定可能） |
| `delete_room` | 指定した部屋データを削除 |
| `get_room_state` | 指定した部屋（省略時はアクティブな部屋）の状態と動線診断を取得 |
| `list_catalog` | スタイルテーマ・標準家具カタログ一覧を取得 |
| `set_room_config` | 部屋の寸法・床材・壁色・照明ムードを変更 |
| `set_openings` | ドア（開き戸/引き戸）・窓・掃き出し窓・クローゼットの位置とサイズを設定 |
| `set_structures` | 柱・壁段差・キッチンカウンター・間仕切り壁などの室内構造物を設定 |
| `apply_style_theme` | スタイルテーマ（`nordic`, `japandi`, `modern`, `cafe`, `korean`）を一括適用 |
| `add_furniture` | 家具を追加（`wall` 指定による壁スナップ配置、または `x, z, rotation` 指定） |
| `update_furniture` | 家具の移動・回転・サイズ変更・色変更・壁寄せ |
| `remove_furniture` | 指定IDの家具を削除（`id: "all"` でその部屋の全家具をクリア） |
| `analyze_layout` | 衝突・柱干渉・ドア開閉干渉・通路幅・床占有率（%）のインテリア診断を実行 |
