# Reading State Worklog — 2026-09-13

## Goal

My Internet Place で記事ごとの READ / SKIP / KEEP を記録し、複数端末で共有する。

## Final architecture

```text
My Internet Place (GitHub Pages)
  ↓ GitHub Contents API
plzsayyes3/my-storage-note
  app-state/my-internet-place/reading-state.json
```

- Cloudflare Worker / D1 は使用しない。
- 状態の正本は `my-storage-note`。
- 認証は既存の共通localStorage key `zen-note-github-token` を再利用する。
- 記事状態そのものはlocalStorageへ保存しない。

## State behavior

- `read`: グレーアウトし、通常順位より下げる。
- `skip`: `read` よりさらに下げる。
- `keep`: 通常順位を維持する。
- 同じ状態をもう一度押すと未処理へ戻す。

## Concurrency

`docs/reading-state.js` は書き込みごとに `reading-state.json` の最新SHAを取得してからPUTする。

409 / 422競合時は最新stateを再取得し、最大3回まで変更を再適用する。

## Changes

- `docs/reading-state.js`
  - Worker API clientからGitHub Contents API clientへ変更。
  - 保存先を `plzsayyes3/my-storage-note/app-state/my-internet-place/reading-state.json` に固定。
  - `zen-note-github-token` を利用。
- Cloudflare案を撤去:
  - `reading-state-worker/src/index.js`
  - `reading-state-worker/schema.sql`
  - `reading-state-worker/wrangler.toml.example`
- 既存のREAD / SKIP / KEEP UI、グレーアウト、順位下降ロジックは維持。

## Canonical specification / log

`plzsayyes3/my-storage-note/app-state/my-internet-place/`

- `README.md`
- `SCHEMA.md`
- `WORKLOG.md`
- `reading-state.json`

## Validation checklist

- [x] my-storage-note に永続state領域を作成
- [x] Knowledge Systemに `app-state` layerを登録
- [x] Worker/D1 clientをGitHub API clientへ置換
- [x] Cloudflare関連ファイルを削除
- [ ] 実ブラウザでREAD操作を行い、`reading-state.json` 更新を確認
- [ ] 別端末で同じ状態が反映されることを確認
