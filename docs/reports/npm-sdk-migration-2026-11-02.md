# Run To Exit — npm SDK v0.1.1 移行・公開検証

## 結果

公開npm SDK `@simpludify/core@0.1.1` / `@simpludify/web@0.1.1` へ完全移行した。エンジンのvendoringを廃止し、既存の脱出計画パズルを維持してmainへ統合。GitHub Pagesの公開版でもデスクトップ・タッチ狭幅のE2E全16件が再試行なしで成功した。

- 公開URL: https://github.oz-coden.com/Run-To-Exit/
- GitHub Pages入口: https://oz-coden.github.io/Run-To-Exit/ （上記へ301転送）
- 移行PR: https://github.com/oz-coden/Run-To-Exit/pull/3 （マージ済み）
- テスト安定化PR: https://github.com/oz-coden/Run-To-Exit/pull/4 （マージ済み）
- Issue: https://github.com/oz-coden/Run-To-Exit/issues/2
- 継続作業ブランチ: `feat/npm-sdk-migration-2026-11-02`

## 変更ファイルと設計

| 対象 | 変更 |
| --- | --- |
| `package.json` / `package-lock.json` | 両SDKを0.1.1に完全固定し、registry URL・integrityで復元 |
| `tsconfig.json` | ゲームとテストのみを型検査 |
| `vendor/` | エンジン等64ファイルを削除 |
| `src/board.ts` | 既存Tilemap・Actor・Canvas UI・PointerClickを維持し、公開presentation Tweenとマップのキーボード操作を導入 |
| `src/main.ts` | 起動前の再実行抑止、対象座標のaria-live、編集・自動再生中のフォーカス保持、手動ステップの表示補間 |
| `src/style.css` | マップのキーボードフォーカス表示 |
| `scripts/notices.mjs` / `third-party/` | npm SDKのLICENSEを収集し、推移依存の不足MIT文面だけ補完 |
| `tests/e2e/game.spec.ts` | 既存ケースを維持し、実タップ、入力分離、フォーカス、SDK版・NOTICE、320px幅の命令スクロールを追加 |
| `README.md` / `docs/architecture.md` / `docs/engine-review.md` | 導入・操作・責務・SDK改善候補を更新 |

`src/model.ts`と`src/stage.ts`は変更していない。整数ステップ、同時移動、占有、追従・位置交換の禁止、Conflict時の全体ロールバック、設備の翌ステップ反映、経路探索、条件待機、スナップショット、ログ・クリア判定はゲーム側に保持する。物理Colliderで離散世界を代替しない。

表示用TweenはBoardの進捗だけを書き換え、確定済みWorld間を補間する。旧Tweenをfinishしてから始点・終点を切り替え、所有者はSceneとする。長い命令リスト、数値入力、ログはDOMを維持。エンジンのコピー、private import、GitHub mainのビルド時取得はない。

## 検証コマンドと結果

| 検証 | 結果 |
| --- | --- |
| `npm ci` | vendor削除後もクリーン復元成功 |
| `npm ls @simpludify/core @simpludify/web` | 両方0.1.1、WebのCoreはゲームと共通化 |
| `npm run check` | 成功 |
| `npm test` | 35件成功。既存の世界更新テストを維持 |
| `npm run build` | Vite本番バンドル、CSS・SVG、NOTICE・依存一覧の生成成功 |
| `npm run test:e2e` | desktop / touch narrowの計16件成功 |
| フォーカステスト各3回・`--retries=0` | 6件連続成功 |
| 公開URLを`E2E_BASE_URL`にした同一E2E | 16件、再試行なしで成功（約2.2分） |
| 開発サーバー | 起動、Canvas生成、JS例外なしを確認 |
| 描画目視 | DOM・Canvas日本語表示、1440px / 320px幅、地形・人物・選択表示を確認 |
| 表示Tween | ブラウザ時計を制御し、開始・100ms・350msで人物の中間位置と終端を確認 |

公開検証は`https://github.oz-coden.com/Run-To-Exit/`で実施。公開HTMLのJS `index-mPG6vG98.js` とCSS `index-DZoYUodD.css` が本番ビルドと一致し、SDK版・ライセンスの配信もE2Eで確認した。

ローカルの標準Playwrightブラウザ取得URLが破損応答になったため、別途用意したChromium 153を`CHROMIUM_PATH`へ指定した。公開検証では実行環境のプロキシと通信待機時間だけを一時設定で補った。プロジェクト依存やCIにこの代替ブラウザ・プロキシ設定は追加していない。GitHub Actionsは標準Playwright Chromiumで検証した。

## コミット・CI・公開経過

| コミット / 実行 | 内容・結果 |
| --- | --- |
| `f699ea618099aa2e34a758801e9557543a24832d` | 引継ぎ元。依存指定と型検査範囲の初期変更 |
| `5df7a6c0c3ad5e33e60613cf434f343f136c3ee2` | npm lockfile、Tween・キーボード、初回報告 |
| [CI 41339105585](https://github.com/oz-coden/Run-To-Exit/actions/runs/41339105585) | 最初のチェックポイント成功 |
| `ad7c977f0144d7d4676fbe64f4b4b2c3a6da464f` | vendor削除、文書、E2E、フォーカス改善 |
| [CI 41339672552](https://github.com/oz-coden/Run-To-Exit/actions/runs/41339672552) | 成功。ただし狭幅テスト1件が再試行で成功したため、後述の安定化を実施 |
| `2c8b087063e2333ec9ae114b0b70714a593c76da` | PR #3のmainマージ |
| [Pages CI 41339986864](https://github.com/oz-coden/Run-To-Exit/actions/runs/41339986864) | main検証・Pagesデプロイ成功。公開版全E2Eの確認対象 |
| `73cf7e37a23d30b6e1d3e0ae938979eb7212b4f3` | フォーカステストを相対ステップ待機へ修正 |
| [CI 41340156429](https://github.com/oz-coden/Run-To-Exit/actions/runs/41340156429) | 単体35件・E2E16件成功。再試行・flakyなし |
| `1bca694df2108d2f6c342efd7cd2d82cdbd2d9e5` | PR #4のmainマージ。変更はテスト・報告のみで公開ゲーム本体は同一 |

CIログ精査で、追加したフォーカステストが「Step 2〜9だけ」を許可する待機条件を持つことを発見した。遅いCIではフォーカス取得中にStep 38へ進み、正常なゲーム動作でも失敗した。フォーカス取得後の現在ステップを記録して次の更新を待つ方式へ変更し、その更新後にフォーカスが保持されることを検証する。失敗ケースの削除や無効化は行っていない。

## SDK改善候補と残る範囲

具体的な目的、公開APIの制約、回避策、追加価値、改善案は[SDK利用レビュー](../engine-review.md)へ記載した。対象はnpm配布READMEの版整合、最小Viteテンプレート、Canvas HUDとViewport連動、DOMとのフォーカス連携、離散世界の表示Tween例、再配布ライセンス生成例。Simpludify本体は変更していない。

移行・ゲーム動作に既知の未解決問題はない。実機iOS Safari / Firefoxは未検証。1ステージ構成、リロード時に計画が消える仕様、追加ステージ・セーブ等の未実装範囲はREADMEの制約に従う。
