# クレジットとライセンス

## 第三者アセット

**現時点で、第三者のモデル・テクスチャ・画像・フォント・音源は一切使用していない。**

[IMPLEMENTATION_PLAN.md §8](IMPLEMENTATION_PLAN.md) のリスク表は
「ホロウマスクの顔モデル調達（ライセンス）」を実装ブロックのリスクとして挙げ、
代替として「簡易なレリーフ状の顔を自前生成」を示していた。**その代替を採った。**

| 種別 | 出どころ |
|---|---|
| 3D モデル | すべて three.js のプリミティブと手続き生成（`src/exhibits/`, `src/world/`） |
| 顔のレリーフ（くぼんだ顔） | ガウシアンの重ね合わせで手続き生成（`src/exhibits/hollowMask.ts`） |
| テクスチャ | すべて Canvas 2D で手続き生成（`src/exhibits/common/CanvasTexture.ts`） |
| ワールド内の文字 | システムフォントを Canvas に焼く（`src/world/TextPlate.ts`）。フォントは配信しない |
| 音 | すべて WebAudio で合成（`src/core/AudioBus.ts`）。音源ファイルは無い |
| 解説文 | すべて独自に執筆（`src/i18n/ja.ts`, `src/i18n/en.ts`） |

したがって `public/` に置かれた素材はなく、帰属表示の義務も発生していない。

将来、外部アセット（CC0 のスキャンモデルなど）を導入する場合は、
この表に **出典・作者・ライセンス・入手日** を追記すること。

## 依存ライブラリ

| ライブラリ | ライセンス | 用途 |
|---|---|---|
| [three.js](https://threejs.org/) | MIT | 3D 描画 |

開発時のみの依存（Vite / TypeScript / Vitest / ESLint / Prettier / happy-dom）は
配信物に含まれない。

## 錯視の出典について

各展示の正式名称・提唱者・先行例は、展示ごとの `reference` フィールドに記載し、
ヒントの第2段階で画面に表示している（[IMPLEMENTATION_PLAN.md §8](IMPLEMENTATION_PLAN.md)
「解説文の正確さ」への対応）。既存の解説文の転載はしていない。

Room D（Opus 棟）の展示について:
**オリジナルなのは体験の設計であって、知覚現象の発見ではない。**
下敷きにした既知の現象と先行例は
[ROOM_D_OPUS_WING.md §0.1](ROOM_D_OPUS_WING.md) の表と、各展示の `reference` に明記している。
