# Room-Sim

Three.js 製の **3D インテリアシミュレーター** と、AIエージェントから部屋管理・家具配置・動線チェックを操作できる **MCP サーバー** です。

## クイックスタート

```bash
# 1. ランタイム準備
mise install

# 2. 3D Webシミュレーター起動 (http://localhost:8765)
mise run dev

# 3. テスト・Lint・SAST 一括実行
mise run ci
```

## AIエージェント / MCP 連携

- **MCP 設定**: リポジトリ直下の [`.mcp.json`](./.mcp.json) がそのまま読み込まれます（`mise run mcp` で起動）。
- **エージェント向け仕様・規約**: 座標系・寸法定義・データ分離ルール・ワークフローは [`AGENTS.md`](./AGENTS.md) を参照してください。

## 主な構成

| ファイル / ディレクトリ | 役割 |
| :--- | :--- |
| `catalog.py` | 汎用家具カタログ・スタイルテーマ・配色パレット定義 |
| `room_engine.py` | 部屋データの永続化・座標計算・干渉/動線/床占有率エンジン |
| `mcp_server.py` | MCP (JSON-RPC 2.0 over stdio) サーバー |
| `server.py` | Web UI & SSE リアルタイム同期サーバー |
| `static/app.js`, `static/meshes.js` | Three.js シーン制御・プロシージャル3D家具モデル生成 |
| `data/rooms/*.json` | 各部屋の保存データ（Git管理外） |
