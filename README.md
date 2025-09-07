## Fashion Fusion (Gemini) 🌐

人物画像 × ファッションアイテム画像 を Gemini (gemini-2.5-flash-image-preview) で合成する最小構成デモ。Next.js (App Router) を静的エクスポート (`output: "export"`) し Azure Static Web Apps Free に載せる想定です。

初期版はフロントエンドから直接 Gemini を呼び出します。後で `/api` (Azure Functions) プロキシに差し替えることで API キー秘匿が可能です。

### 技術スタック

- Next.js 15 App Router / Static Export
- TypeScript
- `@google/genai` SDK
- (将来) Azure Static Web Apps 内蔵 Functions

---

### セットアップ

```bash
git clone <this-repo>
cd fashion-fusion
cp .env.local.example .env.local  # 例: Windows PowerShell -> Copy-Item .env.local.example .env.local
# .env.local を開き API キーを設定
npm install
npm run dev
```

ブラウザ: http://localhost:3000

`人物画像` と `アイテム画像` (帽子/服/ズボンなど) をアップロードし、プリセットボタンやテキストエリアでプロンプトを調整して「合成する」。結果が Base64 画像で表示されダウンロード可能です。

---

### ビルド & 静的書き出し

```bash
npm run build
npm run export  # Next 15 では build 内で export され out/ 生成 (output: export 指定時)
```

出力ディレクトリ: `out/` (SWA の静的資産としてそのまま利用)

---

### Azure Static Web Apps へのデプロイ (手動最小パターン)

1. GitHub リポジトリへ push
2. Azure Portal -> Static Web Apps -> Free Plan で新規作成
3. Build 設定:
   - Build Presets: Custom
   - App location: `/`
   - Output location: `out`
   - (Api location は空 / もしくは後で `api` 追加時に `api` 指定)
4. GitHub Action が走り完了後 URL で確認

環境変数 (API キー) をポータルで設定する場合: Static Web App -> Configuration -> `NEXT_PUBLIC_GEMINI_API_KEY`

---

### 将来の安全版 (Functions プロキシ) への拡張アイデア

1. `api/generate` Azure Function (Node.js, isolated or v4) を追加
2. フロントからは `/api/generate` に FormData (画像+指示文) 送信
3. Function 内で Gemini SDK 呼び出し (API キーはフロントに公開しない App Setting `NEXT_PUBLIC_GEMINI_API_KEY`)
4. 画像サイズ/ファイルタイプ検証 & レートリミット (例: IP ベース簡易トークンバケット)
5. 返却 JSON `{ imageBase64: "..." }`
6. フロント側は `fetch('/api/generate')` へ差し替え

---

### 注意事項

- フロント直呼びは必ず個人/検証用途に留める
- 画像は合計 ~20MB 未満推奨
- 生成画像には SynthID のウォーターマーク (不可視) が含まれる可能性

---

### ライセンス

Prototype / 個人検証用 (必要に応じて追記)

---

### 次のステップ例

- Dropzone UI やプレビュー表示
- 進捗バー / 履歴保持 (IndexedDB)
- 自動背景除去 (前処理) → Gemini への入力最適化
- モバイル最適化 / レスポンシブ

Happy hacking! 🍌
