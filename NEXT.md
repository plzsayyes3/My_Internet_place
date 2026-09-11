# Next

## Current priority

Genre taxonomy v3を、既存の収集・表示を壊さず段階導入する。

設計の正本:

- [`GENRE-DESIGN-V3.md`](GENRE-DESIGN-V3.md)

実装順:

1. `config/interests.yml` をv3 schemaへ移行する。
2. `config/sources.yml` を `default_topics` / `source_kind` / `default_content_type` 方式へ移行する。
3. `src/collect.py` をv3対応し、既存データとの互換性を維持する。
4. 生成JSONに `primary_category` と最大3件の scored `topics` を追加する。
5. 既存のRSS/Atom収集、`FOR YOU`、`LATEST` が壊れていないことを確認する。
6. 8大分類のUIフィルタを追加する。
7. その後に `DISCOVERY` と `気になる / 興味なし` の学習を実装する。

## Later

- 実際に読んで、情報源とスコアリングの偏りを調整する。
- ニュース以外の良質な記事・ブログ・リリース・論文へ取得範囲を広げる。
- 必要ならAIによる要約・推薦理由を後段で追加する。

## Parallel work rule

他AIも作業する可能性があるため、変更直前に最新 `main` HEAD と対象ファイルSHAを確認する。分類移行に関係しない大規模リファクタリングやUI変更は同時に行わない。
