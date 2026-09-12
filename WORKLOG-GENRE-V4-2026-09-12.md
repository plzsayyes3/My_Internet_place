# My Internet Place — Genre v4 作業ログ / AI引き継ぎ

更新: 2026-09-12
対象: `plzsayyes3/My_Internet_place`
ブランチ: `main`

## この文書の目的

ニュース・記事ジャンル分類 v4 の調査・実装内容と、次のAIが作業を継続するために必要な状態を残す。

今回のスコープは **ジャンル分類の品質と表示への反映のみ**。ニュースソース追加、翻訳機能、UI大改修、別機能追加には広げない。

---

## ユーザーの意図

My Internet Place を開いたときに「今、何の情報を見ているか」が自然に分かる分類にする。

重要な設計原則:

- genre = 記事そのものの種類
- topic = genre 内の細分類
- signal = ユーザーの関心との一致
- score = 関心度・ランキング
- genre と signal / score を混同しない
- 原則 1記事1 primary genre
- source だけで分類しない
- title / description / feed category / URL / metadata を組み合わせる
- 同じテーマの記事の genre が揺れすぎないよう優先順位を持つ
- Other に大量に逃がさないが、根拠のない分類をするより Other を許容する

個人的な長期関心の正本は `plzsayyes3/gpts/interests/discovery-profile.yml`。My Internet Place 側へは個人的文脈をコピーせず、公開可能な topic / signal / terms / query / weight / downrank 等に抽象化する。

---

## 調査時に分かった旧状態

v3 は既に `GENRE-DESIGN-V3.md` と `config/taxonomy.yml` に存在していたが、実際には8分類中心だった。

主な問題:

1. Small Devices が Making に折り畳まれていた。
2. iOS / Apple が Lifestyle 系に寄っていた。
3. Pokemon は genre ではなく主に signal 扱いで、実記事が `other` になる例があった。
4. `docs/app.js` に旧ジャンル一覧がハードコードされていた。
5. 生成JSONは `primary_category` / `score` 中心で、genre / interest_score の意味が不明瞭だった。
6. 分類材料が title + summary に偏っていた。
7. topic 同点時の決定が安定していなかった。
8. 広いRSSでも `default_topics` fallback が働き、sourceだけで誤分類することがあった。
9. ASCII term の部分一致により `journal` が `journalism` に当たる等のノイズがあった。
10. `keyboard + display` のような一般語だけで cyberdeck combination bonus が付くケースがあった。

---

## v4 のトップレベル genre

以下の12分類へ変更。

- `ai` — AI
- `knowledge` — KNOWLEDGE / NOTES
- `software` — SOFTWARE
- `making` — MAKING
- `small_devices` — SMALL DEVICES
- `ios_apple` — iOS / APPLE
- `education` — CHILDCARE / EDUCATION
- `work` — WORK / TASK
- `personal_web` — PERSONAL WEB
- `games` — GAMES / POKEMON
- `lifestyle` — LIFESTYLE
- `other` — OTHER

細分類は genre を増やさず topic / signal に残す。

例:

- AI: foundation model / AI tools / agent / local AI / AI coding / use cases
- Knowledge: Obsidian / PKM / daily notes / handwriting / local-first / systems thinking
- Small Devices: ESP32 / e-paper / wearable / input device / cyberdeck
- Games: Pokemon
- Software: web / GitHub / Obsidian Plugin / programming など

---

## 分類パイプライン

意図する処理順:

```text
article
  ↓
normalize classification text
  ↓
genre/topic rules
  ↓
primary genre
  ↓
interest signal matching
  ↓
interest score / rank score
```

生成記事では概念的に以下を分離する。

```text
genre            = 記事が何の記事か
topics           = genre 内の分類座標
matched_signals  = 個人的な関心に何が刺さったか
interest_score   = 関心度
rank_score       = FOR YOU 等の並び順
```

互換性のため `primary_category` / `score` は当面残すが、新設計では `genre` / `interest_score` を優先する。

---

## 分類優先順位

固有性の高い領域を優先する。

同点時の genre 優先順位:

```text
Games
→ Small Devices
→ iOS / Apple
→ AI
→ Knowledge
→ Software
→ Making
→ Education
→ Work
→ Personal Web
→ Lifestyle
→ Other
```

また単純な topic ID の辞書順ではなく、topic score、title一致の強さ、genre priority を使うよう整理した。

---

## 実装した主な変更

主な対象ファイル:

- `config/taxonomy.yml`
- `config/interests.yml`
- `config/discovery.yml`
- `config/sources.yml`
- `src/collect.py`
- `src/merge_discovery.py`
- `docs/app.js`
- `tests/test_scoring.py`
- `GENRE-DESIGN-V3.md`（既存設計文書も参照）

実装内容:

### 1. genre / signal / score を明示的に分離

Pokemon の例:

```text
genre = games
topic = pokemon
signal = pokemon
```

Cyberdeck の例:

```text
genre = small_devices
topic = embedded_devices
signal = cyberdeck
combination = cyberdeck_build
```

### 2. Small Devices / iOS / Pokemon を独立 genre 化

以前の Making / Lifestyle / Other への押し込みを解消。

### 3. UI のジャンル一覧を生成データに追従

`docs/app.js` は固定の旧ジャンル一覧ではなく生成JSON側の genre 情報を読む方向へ変更。記事フィルタも `genre` を優先する。

### 4. source依存を弱める

広いfeedの `default_topics` fallback を解除。

特に調整した broad feed:

- Hackaday
- Raspberry Pi News
- Simon Willison's Weblog

狭い公式feedでは fallback を残してよい。

### 5. ASCII語の単語境界

`journal` → `journalism` のような部分一致誤判定を防止。

### 6. combination bonus に必須アンカー

`keyboard + display` だけで cyberdeck bonus が付かないようにした。

### 7. 汎用 programming topic を追加

Python / Rust / programming 等の記事を「AI系ブログだからAI」のようにsource依存で分類せず、本文から SOFTWARE にできるようにした。

---

## 実記事検査で発見し修正した例

- e-paper 記事 → SMALL DEVICES: 正常
- Raspberry Pi Cyberdeck → SMALL DEVICES + cyberdeck: 正常
- Pokemon公式記事 → GAMES / POKEMON: 正常化
- Obsidian Mobile → 本文のiOSに引っ張られる問題: title優先で修正
- Obsidian Desktop → keyboard/displayだけでCyberdeck bonus: 修正
- OpenAI journalism → `journal` 部分一致: 修正
- Hackadayの一般ネットワーク記事 → source fallbackだけでSmall Devices: 修正
- Godot/Rust terminal → AIへ寄る: programming topic追加で対処
- Raspberry Piの企業/証券取引所系記事 → feed名だけでSmall Devices: broad feed fallback解除

---

## PR / commit の流れ

主要変更は複数の小さいPRに分けて main へ反映済み。

- PR #2: genre v4 の主要実装
- PR #3: 実記事検証で見つかった誤判定の精度調整
- PR #4: source依存をさらに減らす最終調整 + programming topic

確認できている主要 main commit:

- `57a322d` — genre v4主要実装のsquash
- `2cdef715688512955aeb2dfa2db35933788b8b28` — source-independent genre tuning
- `211a049341a4b665c8b674cf2c667b63d17ccbe6` — 最終の summary multiplier 調整

※作業開始時/再開時は必ず最新 `main` HEAD を再確認すること。他AIが並行変更している可能性あり。

---

## CI / 再生成の状態

途中のv4では以下まで確認済み:

- taxonomy tests 成功
- RSS collect 成功
- discovery merge 成功
- 生成データ: 約211記事
- feeds: 12/12 healthy

ただし最終PR #4後、追加した `programming` の回帰テストで1件失敗した。

失敗:

```text
test_generic_programming_article_is_software
expected: software
actual: other
```

原因は `programming` topic 自体ではなく、summaryに1語だけ一致した場合の重みが分類閾値未満だったこと。

そこで最後に `config/taxonomy.yml` の重みを以下へ変更した。

```yaml
title_multiplier: 2.0
summary_multiplier: 1.5
metadata_multiplier: 0.5
```

旧 `summary_multiplier` は `1.0`。

意図:

- title の一致を最重要にする
- description / summary 単独の明確な1語一致も分類根拠として使えるようにする
- metadata/source は補助に留める

この変更 commit が `211a049...`。

### 重要: 次のAIが最初にやること

**この `211a049...` 後のGitHub Actions結果を確認すること。**

前回のAction run `34663773448` は `2cdef715...` 時点で taxonomy test failure のため collect が安全にskipされた。`211a049...` push 後の新しいrunが成功しているかを確認する。

成功条件:

1. taxonomy tests 全件成功
2. collect feeds 成功
3. merge discovery 成功
4. `data/latest.json` / `docs/data/latest.json` が v4 で再生成
5. generated JSON の genre一覧が12分類体系と整合

---

## 最終検証として残っている作業

CI成功後、生成済みJSONから最低20〜30記事を横断サンプリングする。

重点確認ジャンル:

- AI
- Small Devices
- cyberdeck
- Obsidian / PKM
- iOS / Apple
- Personal Web
- Childcare / Education
- Pokemon
- Software / programming

各記事で最低限見る項目:

```text
title
source
genre / primary_category
topics
matched_signals
interest_score / rank_score
```

特に以下を再確認:

- broad feedの記事がsource名だけでgenreを決められていないか
- summary_multiplier 1.5 によって逆に一般語の誤分類が増えていないか
- programming が AI / Knowledge / Small Devices を不必要に奪っていないか
- Pokemon が Other に落ちていないか
- Obsidian が iOS記述だけで iOS / Apple に奪われていないか
- Cyberdeck bonus が一般的なkeyboard/display記事に発火していないか

明らかな誤分類がなければ genre v4 の今回スコープは完了扱いでよい。

---

## 今回やらないこと

次のAIは、今回の検証中に以下へスコープを広げないこと。

- 新規ニュースソース追加
- Pokemon source追加
- 翻訳方式変更
- UIデザイン大改修
- FOR YOU自体の全面再設計
- discovery方式の全面変更
- 個人情報を gpts から公開repoへコピー

必要なら別タスクとして切り出す。

---

## 設計判断の要点

今回の重要な判断は「カテゴリを細かく増やすこと」ではない。

**genreは安定した地図、topicは記事内容の座標、signalは個人の関心、scoreは優先順位** と役割を分ける。

そのため、今後関心が変化した場合も genre taxonomy を頻繁に変えるのではなく、主に `config/interests.yml` / discovery profile / signal weight 側を調整する。

genre taxonomy を変更するのは「記事の種類として見分けたい領域そのものが変わったとき」に限定する。
