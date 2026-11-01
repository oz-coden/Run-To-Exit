# npm SDK v0.1.1 移行検証

## 対象と状態

- Issue: https://github.com/oz-coden/Run-To-Exit/issues/2
- PR: https://github.com/oz-coden/Run-To-Exit/pull/3
- ブランチ: `feat/npm-sdk-migration-2026-11-02`
- 引継ぎ元: `f699ea618099aa2e34a758801e9557543a24832d`
- main基準: `34ebcc4e5b60d0813daef082a671c575378fe0df`

## 第1チェックポイント

`package-lock.json`をnpm公開パッケージから再生成。`npm ci`成功、`npm ls @simpludify/core @simpludify/web`は両方0.1.1、WebのCore依存は共通インスタンスに解決。型検査、単体35件、本番ビルド成功。

`src/board.ts`は公開 `Scene.presentationTweens` / `Tween.bind` / `Easing` による描画補間と、マップの矢印キー・Enter操作を導入。`src/main.ts`は命令削除・並べ替え後のフォーカス復帰と起動前の再実行抑止を追加。世界更新モデルは維持。

`scripts/notices.mjs`はnpmパッケージのLICENSEを使用。文面が同梱されていない`@pixi/colord`のMITライセンスのみ`third-party/colord/LICENSE.md`へ移動。

次の作業: ブラウザE2E、描画・タッチ・狭幅確認後にvendor削除、文書更新、CI成功確認とmain統合。Pagesはまだ旧mainの公開状態。

ローカルのPlaywrightブラウザ配布アーカイブ取得が破損応答となるため、実行可能なChromiumを別途準備中。テストは無効化しない。
