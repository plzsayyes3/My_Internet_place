# My Internet Place

自分の関心に沿って、ニュース・記事・ブログ・ツール・リリースなどを集めるための公開リポジトリです。

## Purpose

- インターネット上の情報を一か所に集める
- RSS / Atom / 公開フィードを中心に、自動収集できる構成にする
- 個人情報や私的な記録は置かない
- 個人知識ベースからは、公開して問題ない抽象化された関心テーマだけを反映する
- 将来的には「なぜこの記事がおすすめなのか」まで表示する

## Flow

```text
Internet
  ↓
Sources (RSS / Atom / public feeds)
  ↓
Collector
  ↓
Article data
  ↓
Interest matching
  ↓
GitHub Pages
```

## Structure

```text
config/
  interests.yml   # 公開可能な関心テーマ
  sources.yml     # 取得元

data/
  latest.json     # 最新の記事一覧

src/
  collect.py      # 記事収集処理

docs/
  index.html      # 公開ビュー
  app.js
  style.css

.github/workflows/
  collect.yml     # 定期実行
```

## Privacy policy

このリポジトリは公開前提です。氏名、家族構成、勤務先、個別案件、生活記録などの個人情報は保存しません。

個人知識ベースの内容を利用する場合も、そのまま転載せず、一般化した「興味カテゴリ・キーワード」のみを利用します。

## Status

Initial scaffold.
