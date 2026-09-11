# My Internet Place

自分の関心に沿って、ニュース・記事・ブログ・ツール・リリースなどを集めるための公開リポジトリです。

単なるRSSリーダーではなく、**「最近の自分が気になるインターネット」をつくるための記事レーダー**を目指します。

## Current MVP

- 公開RSS / Atomフィードを自動収集
- 公開可能な関心プロファイルで記事をスコアリング
- 古すぎる記事・追跡パラメータ・重複URLを整理
- 一部のフィードが落ちても他の取得を継続
- GitHub Pages向けの静的リーダーを生成
- `FOR YOU` / `LATEST` / カテゴリ別に閲覧
- 取得元ごとのフィード健全性を表示

## Flow

```text
Public Internet
  ↓
config/sources.yml
  ↓
GitHub Actions / src/collect.py
  ↓
data/latest.json
  └─ docs/data/latest.json
       ↓
GitHub Pages reader
```

## Schedule

GitHub Actionsで1日3回収集します。

- 06:25ごろ JST
- 12:25ごろ JST
- 20:25ごろ JST

GitHub Actionsのscheduled workflowは厳密な定刻実行を保証しないため、時刻は目安です。`workflow_dispatch` による手動実行にも対応しています。

## Initial sources

初期段階では、情報源を増やしすぎず、公式・一次情報を中心にしつつ発見用フィードを少量混ぜています。

- OpenAI News
- Obsidian Blog
- Obsidian Changelog
- GitHub Changelog
- GitHub Blog
- Simon Willison's Weblog
- Hackaday
- Hacker News via HNRSS

取得元は `config/sources.yml` で管理します。

## Public interest profile

`config/interests.yml` には、公開して問題ない一般化された関心テーマだけを置きます。

例:

- AI / AIツール
- ナレッジ管理・ノート
- ソフトウェア制作
- 小型デバイス・iOS
- メイキング
- 保育・教育
- タスク・仕事設計
- 個人Web・RSS

このリポジトリから個人知識ベースを直接公開・複製することはしません。

### Genre taxonomy v3

次の分類設計は [`GENRE-DESIGN-V3.md`](GENRE-DESIGN-V3.md) を正本とします。

- UI上の大分類は8個に抑える
- 内部では25個程度のtopicを持つ
- `content_type` / `source_kind` / `reading_depth` を別軸にする
- topic間の関係を将来の推薦・DISCOVERYに使う
- `DISCOVERY` はジャンルではなく推薦モードとして扱う

実装担当AI・開発者は、分類関連コードを変更する前にこの設計書を確認してください。

## Privacy boundary

このリポジトリは**公開前提**です。

置かないもの:

- 氏名・住所・連絡先
- 家族構成や生活記録
- 勤務先・個別案件・非公開の仕事情報
- 個人知識ベースの生データ
- 閲覧履歴など個人を特定しやすい行動ログ
- APIキーやトークン

個人知識ベースを推薦改善に利用するときも、そのまま転載せず、公開可能な興味カテゴリ・キーワードへ抽象化した結果だけを利用します。

## Structure

```text
config/
  interests.yml   # 公開可能な関心テーマ
  sources.yml     # 公開フィードの取得元

data/
  latest.json     # 収集データ

src/
  collect.py      # 収集・整理・スコアリング

docs/
  index.html      # 公開ビュー
  app.js
  style.css
  data/latest.json

.github/workflows/
  collect.yml     # 定期収集
```

## Next

1. Genre taxonomy v3を、既存動作を壊さず `interests.yml` / `sources.yml` / `collect.py` に導入する
2. 実際に読んで、情報源とスコアリングの偏りを調整する
3. 「気になる / 興味なし」のフィードバック設計を追加する
4. ニュース以外の良質な記事・ブログ・リリース・論文へ取得範囲を広げる
5. 必要ならAIによる要約・推薦理由を後段で追加する

まずは、AI APIに依存せず安定して流れ続ける小さな仕組みを土台にします。
