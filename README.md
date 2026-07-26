# Optical Illusion Museum（錯視のミュージアム）

Claude Opus 5 high 製のブラウザで歩き回れる 3D 錯視ミュージアム。


館内には 17 の展示が並び、それぞれ「立って見るべき場所」から覗くと錯視が成立します。

見え方の答えは最初は隠れています。ヒントを開くと段階的に説明が出て、展示によっては**タネあかし**でカメラが動き、仕掛けそのものを見せます。

Three.js + TypeScript のみで構成されており、**外部の 3D モデル・テクスチャ・音源・
フォントを一切使いません**。形は three.js のプリミティブと手続き生成、
テクスチャは Canvas 2D、音は WebAudio の合成で作っています
（[Docs/CREDITS.md](Docs/CREDITS.md)）。

## 展示

| 部屋 | テーマ | 展示 |
|---|---|---|
| Room A | 平面のだまし絵 | カフェウォール錯視 / ミュラー・リヤー錯視 / チェッカーシャドウ錯視 / エビングハウス錯視 / ヘリング錯視 / 回転する蛇 |
| Room B | あり得ない立体 | ペンローズの三角形 / ペンローズの階段 / ネッカーキューブ / アナモルフォーシス |
| Room C | 空間と身体 | エイムズの部屋 / ブーシェの椅子 / くぼんだ顔 / ポンゾ錯視の廊下 |
| Room D | Opus 棟：絵にできない錯視 | 縮んでいく部屋 / 聞こえる衝突 / 縞の下の嘘 |

Room D は、静止画では成立しない — 移動・音・時間を使う錯視を集めた棟です。
体験の設計はオリジナルですが、下敷きにした既知の現象と先行例は
[Docs/ROOM_D_OPUS_WING.md](Docs/ROOM_D_OPUS_WING.md) と各展示の `reference` に明記しています。

## 操作

**キーボード / マウス**

| | |
|---|---|
| 移動 | `W` `A` `S` `D` ／ 矢印キー（`Shift` で早歩き） |
| 視点 | マウス。画面をクリックで視点操作に入り、`Esc` でカーソルが戻る |
| 決定 | `F` |
| ヒント | `H` |
| タネあかし | `R` |
| 展示一覧 | `Tab` |
| 設定 | `O` |

**タッチ**: 画面の左半分をドラッグで移動、右半分をドラッグで視点。
操作ボタンは画面下部のアクションバーに出ます。

視野角・感度・上下反転・頭の揺れ・画質・モーション控えめ・消音は設定から変更でき、
`localStorage` に保存されます。3D 酔いが出やすい「縮んでいく部屋」の効果は
単独で切れます。

日本語 / 英語の切り替えに対応しています。

## セットアップ

```bash
npm install
```

```bash
npm run dev
```

表示された URL（既定で http://localhost:5173 ）を開きます。

## スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー（Vite） |
| `npm run build` | 型チェック（`tsc --noEmit`）+ 本番ビルド |
| `npm run preview` | ビルド結果をローカル配信 |
| `npm test` | ユニットテスト（Vitest, 195 件） |
| `npm run test:watch` | テストの監視実行 |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

`npm run build` の出力先は `dist/`（Git 管理外）。
GitHub Pages のようなサブパス配信を前提に `base` は環境変数で切り替えます。
ルート配信なら次のようにします。

```bash
BASE_PATH=/ npm run build
```

## 構成

```
src/
  core/        描画基盤・ループ・入力抽象化・設定・音・品質制御
  world/       建築（部屋 / 壁 / 照明 / 当たり判定 / 案内板）
  data/        部屋と通路のレイアウト定義
  exhibits/    展示 17 件と共通実装（パネル / 不可能図形 / 視線投影 / 種明かしカメラ）
  viewpoint/   ViewSpot（立ち位置の誘導とカメラ固定）
  player/      移動と視点操作
  ui/          HUD・ヒント・展示一覧・設定・仮想パッド
  i18n/        日本語 / 英語の辞書
tests/         Vitest（レイアウト整合・配置検証・入力・UI ほか）
tools/         フォントのサブセット化（現状は未使用。将来の見出し書体用）
Docs/          計画・改修計画・QA チェックリスト・クレジット
```

`public/` の `audio/` `models/` `textures/` は空です（すべて手続き生成のため）。

## ドキュメント

- [Docs/PLAN.md](Docs/PLAN.md) — 企画のねらい
- [Docs/IMPLEMENTATION_PLAN.md](Docs/IMPLEMENTATION_PLAN.md) — 実装計画（Phase 0〜8）
- [Docs/IMPROVEMENT_PLAN.md](Docs/IMPROVEMENT_PLAN.md) — レビュー後の改修計画（Phase 9 以降）
- [Docs/ROOM_D_OPUS_WING.md](Docs/ROOM_D_OPUS_WING.md) — Opus 棟の設計
- [Docs/QA_CHECKLIST.md](Docs/QA_CHECKLIST.md) — 手動 QA の観点
- [Docs/CREDITS.md](Docs/CREDITS.md) — アセットと依存ライブラリのライセンス

## ライセンス

MIT License — [LICENSE](LICENSE) を参照してください。
