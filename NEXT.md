# Next

## Current state

Genre taxonomy v3 の基盤実装は完了。

- 8大分類 / 25 topic を実装済み
- `taxonomy.yml` / `interests.yml` / `discovery.yml` / `sources.yml` の役割を分離
- `sources.yml` は `default_topics` / `source_kind` / `default_content_type` 方式へ移行済み
- 生成JSONに `primary_category` と scored `topics` を追加済み
- 現行UI向け互換フィールドを維持
- GitHub Actions の分類テスト・RSS/Atom収集とも成功

設計の正本:

- [`GENRE-DESIGN-V3.md`](GENRE-DESIGN-V3.md)

## Next priority

まず実データを観察し、分類の精度を調整する。

1. 実際の記事で `primary_category` / `topics` の誤分類・不足を確認する。
2. 必要な範囲だけ `taxonomy.yml` の keywords と `interests.yml` の weights/signals を調整する。
3. `content_type` / `reading_depth` をソース既定値から記事単位で推定する必要があるか判断する。
4. 「気になる / 興味なし」の保存方式を、公開リポジトリに個人閲覧履歴を出さない前提で設計する。
5. topic relations を使った related-interest 推薦を追加する。
6. `DISCOVERY` を実装する。
7. 最後に `discovery.yml` の query を使う能動Web検索を実装する。

## Later

- 情報源の偏りを調整する。
- ニュース以外の良質な記事・リリース・論文・HOW-TOを増やす。
- 必要ならAI要約や推薦理由生成を後段で追加する。

## Parallel work rule

他AIは分類関連作業の前に `GENRE-DESIGN-V3.md` を確認する。
変更直前に最新 `main` HEAD と対象ファイルSHAを確認し、無関係な大規模リファクタリングを同時に行わない。
