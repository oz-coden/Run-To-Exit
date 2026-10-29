# 構成と責務

## 独立したソースワークスペース

`vendor/simpludify/core` と `web` は固定コミットの公開パッケージ。公式 `npm run create -- ../run-to-exit-scaffold` で生成したワークスペースから、変更せずにパッケージとMITライセンスを採用した。不要なエンジン用サンプル・サイト・開発テストはゲームにコピーしていない。ゲーム側のnpm workspacesとlockfileがローカル・CI共通の導入単位となる。Coreのtsconfigが相対参照する共通設定を `vendor/tsconfig.json` で補う。

CoreはDOM・Pixiを含まない。WebはGameの非同期起動、シーン、描画、ブラウザ入力を担当する。ゲームのファイルは両パッケージの公開exportからだけimportする。エンジンのsrcへ直接importしない。ゲーム仕様のためのエンジン変更は行わない。

| ファイル | 責務 |
| --- | --- |
| `src/model.ts` | 純粋な世界更新、Grid、BFS、命令、設備、スナップショット、ログ |
| `src/stage.ts` | オリジナルの地形・設備・人物と検証済み攻略例 |
| `src/board.ts` | Tilemap、SpriteSheet、人物ActorとComponent、補間、Canvas UI/Flex、PointerEvent |
| `src/main.ts` | 命令エディタ、再生ペース、DOMログと画面状態、Gameライフサイクル |
| `src/assets/*.svg` | 独自に作成したタイルと人物の図形 |
| `tests/unit` | Nodeでの世界更新検証 |
| `tests/e2e` | プレイヤーの操作による本番バンドル検証 |

## 計画と世界の所有権

編集用 `draft` はプレイヤーが変更できる。`startRun(stage, draft, seed)` はdeep copy/freezeしたステージと計画を持つ新しい実行を生成する。世界の初期状態、最後に確定した状態、成功したステップ履歴、成功/失敗ログを分離する。`advance` は候補にだけ変更を加え、失敗時は受け取った状態そのものを返す。Conflictで停止した実行は新しい実行を作るまで進めない。

## Simpludifyとゲーム時間

Gameの `scene('puzzle', setup)` でマップ、Actor、Canvas UI、購読、描画更新を所有する。`await game.run('puzzle')` の成功後に再生操作を有効化する。Worldの初期化と再実行はモデルを交換するため、シーン全体を作り直す必要がない。非同期の別画面への移動には公開 `game.goTo` があるが、1ステージの初期版では利用していない。

SceneのonUpdateが再生ペースを受け持つ。秒数の蓄積から整数世界ステップを順に要求し、その前後を描画で補間する。世界更新に実フレーム時間は入らない。ゲームの一時停止はこの要求を止め、描画や命令編集を継続する。エンジン全体をpauseする必要はない。

世界ステップはゲーム固有の整数時間なので、Sceneの秒単位Timerに設備予約を置かない。Timer APIは所有者付きの演出には使えるが、今回の扉予約はWorld内のシリアライズ可能なデータである。確定通知は `defineEvent<Run>` とSceneのEventBusを使い、設備判定の途中でイベントを配信しない。

`Board` はScene所有のTilemap、Actor、Transform、Renderable、CanvasNodeを用い、地形と人物を表示する。閉じた扉や占有の判定はCollisionWorldではなく整数モデルが担当する。連続座標のSolid補正はパズル規則に不要。公開APIの `game.setViewport` で上部Canvas UIと下部マップ入力の領域を分ける。PointerClickのworld座標をTilemap.worldToTileへ渡す。

ページ終了時とHMR時に `game.dispose()`。BoardのResizeObserverとDOM購読もSceneの破棄で解除する。画像参照とCanvasミラーの寿命はエンジンへ委ねる。計画はページ内のみ保持する。

## ビルドと配信

Viteはパッケージのソースexportを直接コンパイルする。baseは `/Run-To-Exit/`、画像は `new URL(..., import.meta.url)` で解決する。外部フォント・CDN・実行時APIを使わず、静的distだけで動く。起動ルートは1つなのでクライアントルーターやSPA用404変換は不要。

ロックされた実行依存のライセンス文面と一覧をdistへ生成する。`@pixi/colord` パッケージに不足する文面は、Simpludifyに収録されたMIT文面を固定コピーして補う。
