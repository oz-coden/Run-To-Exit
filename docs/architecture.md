# 構成と責務

## 公開npm SDKを使う独立プロジェクト

Core / Webは公開npmパッケージの0.1.2を完全固定して導入する。`npm ci`とlockfileがローカル・CI共通の復元手順となる。WebのCore依存も0.1.2であり、ゲームの直接依存と同じパッケージを共有する。エンジンソースの収録、ローカルワークスペース、GitHub mainの取得は不要。

CoreはDOM・Pixiを含まない。WebはGameの非同期起動、シーン、描画、ブラウザ入力を担当する。ゲームは両パッケージの公開exportだけを使い、配布物内部のパスには依存しない。ゲーム固有の世界規則はエンジンへ移さない。Canvasのテキストセマンティクスと動的フォーカスは汎用SDKの改善として別途検証する。

| ファイル | 責務 |
| --- | --- |
| `src/model.ts` | 純粋な世界更新、Grid、BFS、命令、設備、スナップショット、ログ |
| `src/stage.ts` | オリジナルの地形・設備・人物と検証済み攻略例 |
| `src/board.ts` | Tilemap、SpriteSheet、人物ActorとComponent、補間、PointerEventとScene所有のAction入力 |
| `src/main.ts` | Canvas UI/Flex、命令エディタ、再生ペース、ログと画面状態、Gameライフサイクル |
| `src/assets/*.svg` | 独自に作成したタイルと人物の図形 |
| `tests/unit` | Nodeでの世界更新検証 |
| `tests/e2e` | プレイヤーの操作による本番バンドル検証 |

## 計画と世界の所有権

編集用 `draft` はプレイヤーが変更できる。`startRun(stage, draft, seed)` はdeep copy/freezeしたステージと計画を持つ新しい実行を生成する。世界の初期状態、最後に確定した状態、成功したステップ履歴、成功/失敗ログを分離する。`advance` は候補にだけ変更を加え、失敗時は受け取った状態そのものを返す。Conflictで停止した実行は新しい実行を作るまで進めない。

## Simpludifyとゲーム時間

Gameの `scene('puzzle', setup)` でマップ、Actor、Canvas UI、購読、描画更新を所有する。`await game.run('puzzle')` の成功後に再生操作を有効化する。Worldの初期化と再実行はモデルを交換するため、シーン全体を作り直す必要がない。非同期の別画面への移動には公開 `game.goTo` があるが、1ステージの初期版では利用していない。

SceneのonUpdateが再生ペースを受け持つ。秒数の蓄積から整数世界ステップを順に要求し、その前後を `Scene.presentationTweens` の公開 `Tween.bind` と `Easing.InOutCubic` で補間する。TweenはBoardの表示進捗だけを書き換え、Worldには触れない。速い手動操作や再実行で補間を置き換える際は旧Tweenをfinishして終端を揃える。Scene破棄時はTweenも解除される。世界更新に実フレーム時間は入らない。ゲームの一時停止はこの要求を止め、描画や命令編集を継続する。エンジン全体をpauseする必要はない。

世界ステップはゲーム固有の整数時間なので、Sceneの秒単位Timerに設備予約を置かない。Timer APIは所有者付きの演出には使えるが、今回の扉予約はWorld内のシリアライズ可能なデータである。画面の更新は `stepRun` が返した確定済みRunだけを読み、設備判定の途中には割り込まない。

`Board` はScene所有のTilemap、Actor、Transform、Renderableを用い、地形と人物を表示する。閉じた扉や占有の判定はCollisionWorldではなく整数モデルが担当する。連続座標のSolid補正はパズル規則に不要。画面を組み立てるmainがCanvasのFlexレイアウトでWorld用の非対話領域を確保し、公開APIの `game.bindViewport(ui, region)` でViewportへ接続する。ヒントの折り返しやリサイズへの追従とScene破棄時の解放はSDKが担当し、Board固有のResizeObserverやHUDの固定高さを持たない。PointerClickのworld座標をTilemap.worldToTileへ渡す。

人物選択、再生操作、命令フォーム、ログ、ヘルプはCanvas UIを使う。入力欄と選択ポップアップのDOMはSDKが所有し、ゲームはHTML要素やネイティブ入力イベントを組み立てない。マップの矢印・Enter / Space入力も `context.actions` と `onPressed` にまとめる。Canvasの操作にフォーカスしている間、またはマップを隠した狭幅タブでは対象マスを動かさない。

命令行は再生中と末尾追加時に同じノードを保ち、削除・並べ替えで再構築した場合だけ残る操作へフォーカスを戻す。0.1.2では新しい配置が決まる次のフレームまでフォーカス要求を保留する。ログは80件単位のページとCanvasScrollを組み合わせ、全履歴を参照できるまま画面ノード数を抑える。選択したログは実行時の固定計画を基準にし、編集後の同番号の別命令を誤って強調しない。

画面幅850px未満はマップ・命令・ログ・ヘルプのタブを切り替える。広い画面ではマップと選択パネルを並べる。レイアウト判定はCanvasの解決済みboundsを読み、独自のDOMサイズ監視やCSSメディアクエリを持たない。World用スロットの祖先は背景でマップを覆わない。

Sceneを作り直すと画面状態とノードも新しく生成する。Sceneの非アクティブ化でフォーカスを解放し、Action、ポインター、画像、Tween、ネイティブミラーの破棄はSDKへ委ねる。HMR時と明示的な埋め込み解除時には `game.dispose()` を使う。計画はページ内のみ保持する。

公開0.1.2は非対話ラベルのセマンティックミラーを持たないため、Canvas版のmain統合と配信は次回SDK公開後に行う。候補tarballの独立検証手順と読み上げ・実機IMEの未検証範囲は[移行報告](work-reports/2026-11-02-canvas-ui.md)を参照。

## ビルドと配信

Viteはnpm SDKのESM配布物と公開エントリから読み込まれるCSSをバンドルする。baseは `/Run-To-Exit/`、画像は `new URL(..., import.meta.url)` で解決する。外部フォント・CDN・実行時APIを使わず、静的distだけで動く。起動ルートは1つなのでクライアントルーターやSPA用404変換は不要。

ロックされた実行依存のライセンス文面と一覧をdistへ生成する。`@pixi/colord` パッケージに不足する文面は、`third-party/colord/LICENSE.md` の固定文面で補う。Simpludify自身のMITライセンスはnpmパッケージのLICENSEを使用する。
