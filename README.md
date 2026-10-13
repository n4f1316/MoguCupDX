# MoguCupDX

maimai の非公式大会「もぐらたたきカップ」の運営ツールです（非公式・ファンメイド）。

- `index.html` … 参加申請フォーム（エントリー名・X の ID・maimai のレート・2fRATE）
- `admin.html` … 運営ページ（管理者用の鍵で保護）
  - 参加者の一覧・編集・削除・CSV 書き出し
  - 大会設定（受付の開始/終了と締切、自選曲の譜面定数の上限・下限、運営課題曲、お知らせ）
  - 組み合わせ（2fRATE 順・ランダム・手動）と、各プレイヤーの自選曲3曲・BAN・自選曲の決定
  - 告知画像（組み合わせ発表／選曲公開／BAN結果・対戦曲）を PNG で保存
- `worker/` … Cloudflare Workers + D1 の API

曲名・ジャケット・譜面定数は 2fRATE（`/dxscore-tools/`）の `maimai_consts_magical.json`・`maimai_jackets.json` をそのまま読み込みます。
ジャケット画像は Worker の `/jacket/` 経由で読み込みます（告知画像に描き込むため）。

## 設置手順

### 1. Worker と D1 を作る

```sh
cd worker
npx wrangler login
npx wrangler d1 create mogucupdx          # 表示された database_id を wrangler.toml に書く
npx wrangler d1 execute mogucupdx --remote --file=schema.sql
npx wrangler secret put ADMIN_KEY         # 運営ページの鍵（長めのランダムな文字列）
npx wrangler deploy
```

`deploy` で表示された URL（例 `https://mogucupdx.<アカウント>.workers.dev/`）を `config.js` の `MOGU_API` に書きます。

Cloudflare のダッシュボードで作る場合は、Worker に `worker.js` を貼り付け、
D1 バインディング `DB`、シークレット `ADMIN_KEY`、変数 `ALLOWED_ORIGINS = https://n4f1316.github.io` を設定し、
D1 のコンソールで `schema.sql` を実行してください。

### 2. GitHub Pages を有効にする

リポジトリの Settings → Pages で `main` ブランチの `/ (root)` を公開します。

- 参加申請: `https://n4f1316.github.io/MoguCupDX/`
- 運営: `https://n4f1316.github.io/MoguCupDX/admin.html`

## メモ

- 同じエントリー名・同じ X の ID での二重申請は受け付けません（大文字小文字は区別しない）。
- 締切は日本時間で判定します。締切を過ぎるか「参加申請を受け付ける」を外すと、申請できなくなります。
- 同名曲のジャケットは、種別（DX/ST）と難易度のレベルで1つに絞れたときだけ表示します。絞れないときは「?」になります。
