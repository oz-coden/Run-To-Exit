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

## 第2チェックポイント

- 初回実装コミット: `5df7a6c0c3ad5e33e60613cf434f343f136c3ee2`
- CI: https://github.com/oz-coden/Run-To-Exit/actions/runs/41339105585 （成功）
- vendoredソース64ファイルを削除。`src/model.ts`と`src/stage.ts`のルール・攻略例は変更なし。
- README、architecture、engine-reviewを公開npm SDKの構成に更新。`third-party/README.md`に補完ライセンスの出典を記録。
- E2Eは12件を維持し、キーボード・フォーム入力分離、命令編集後フォーカス、配布SDKの版・ライセンス、320px幅・長い命令列を追加。狭幅のマップ操作は実際のtouchscreen.tapで検証。
- vendor削除後、`npm ci`・`npm run check`・`npm test`（35件）・`npm run build`・`npm run test:e2e`（16件）が成功。
- ローカルChromium配布URLの破損応答は、テスト用に別途取得したChromium 153を`CHROMIUM_PATH`へ指定して回避。依存・CI設定には追加していない。CIは標準Playwright Chromiumで成功。
- 日本語フォントを備えたローカルブラウザでDOM・Canvasの日本語描画を目視確認。開発サーバー起動、Canvas生成、JS例外なし、320px幅の横はみ出しなしも確認。
- 自動再生中の命令行再描画でもフォーカスを保持する改善を追加し、対応E2Eを拡張。

設計判断: 表示用TweenはScene所有とし、ゲーム状態の更新・扉期限・Conflictは純粋モデルに残す。命令リストやフォームはDOMを継続し、Canvas UIの利用率を目的にしない。

変更ファイル: `package.json`、`package-lock.json`、`tsconfig.json`、`src/board.ts`、`src/main.ts`、`src/style.css`、`scripts/notices.mjs`、`third-party/`、`tests/e2e/game.spec.ts`、`README.md`、`docs/architecture.md`、`docs/engine-review.md`、本報告。削除対象は`vendor/`全体。

未完了: 最終差分CIとレビュー、PRのReady化・main統合、Pages配信版での全E2E確認。実機iOS Safari / Firefoxは検証対象外。計画保存・追加ステージ等の既存未実装範囲はREADME参照。


## main統合とCIログレビュー

- 最終実装コミット: `ad7c977f0144d7d4676fbe64f4b4b2c3a6da464f`
- ブランチCI: https://github.com/oz-coden/Run-To-Exit/actions/runs/41339672552 （成功。ただしE2E 1件は再試行）
- PR #3をReady化してmainへマージ。マージコミット: `2c8b087063e2333ec9ae114b0b70714a593c76da`。
- 詳細ログで狭幅のフォーカステストに時間依存の判定を検出。期待値がStep 2〜9だけを許可し、CIではフォーカス待ち中にStep 38へ進んでいた。ゲーム本体の失敗ではなく、テストの観測条件に上限がある問題。
- 修正: フォーカス取得後の現在ステップを記録し、それより次のステップへ進んだ後もフォーカスが保持されることを検証。再試行での成功だけに依存しないよう追補CIを実行する。
- 描画補間はブラウザ時計を制御し、開始・100ms・350msで人物の横位置が順に変化することも確認。

この時点ではPagesデプロイ・公開版E2E確認を継続中。最終結果は下記の公開確認欄およびPRに記録する。
