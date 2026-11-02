# Simpludify公開npm SDKの利用レビュー

対象: **`@simpludify/core@0.1.2` / `@simpludify/web@0.1.2`**。エンジン本体を変更せず、npmパッケージの公開exportのみを使う。

## 利用結果と責務

Grid、Tilemap / SpriteSheet、Actor / Transform / Renderable、Game / Scene、CanvasButton / Row / Column / Label / Panel、PointerClick、defineEvent、bindViewport、presentationTweens / Tween.bind / Easing、非同期起動とdisposeを利用する。従来の地形描画と入力は同じ公開APIで移行できた。WebのCore依存は完全固定0.1.2で、ゲーム側のCoreと重複しない。

整数ステップ、同時移動、占有、Conflict時の全体ロールバック、命令スナップショット、経路探索、設備予約、ログはゲームの純粋モデルに残す。物理Collider、秒単位Timer、Tweenに離散世界の規則を担当させない。Tweenは確定済みWorld間の表示だけを補間する。

## v0.1.2での改善結果

npmレジストリからCore/Webをv0.1.2へ更新し、World用のCanvasPanelを`Game.bindViewport()`でViewportへ接続する。Board専用のResizeObserverと固定64/96pxの余白計算を除去し、Boardは18行削除・5行追加（正味13行減）となる。Canvas UIの高さを100%とし、World領域は`pointerEvents: "none"`でマップ入力を遮らない。

本番エントリのGameをESM exportとして保持し、ブラウザ検証は実際の公開worldToScreen APIから座標を取得する。Viewportの定数コピーやwindowへの検証専用グローバルは使用しない。整数ステップ、Conflictと命令実行のモデルは変更しない。

## v0.1.1利用時の改善候補（履歴）

以下はv0.1.1移行時に記録した制約と回避策。Viewport連動、配布READMEの整合性、独立スターターはその後のSDK整備で対応した。

### 1. npm向け最小テンプレートと配布READMEの整合性

- 実現したいこと: npm版SDKを固定し、Viteで独立ゲームを開始する。
- 制約: 配布0.1.1のREADMEは「v0.1.0」「配布準備中」「公開確認前」の表記と0.1.0の導入例が残る。パッケージ本体は0.1.1で取得・動作可能だが、初見では利用可能な版を判断しにくい。
- 回避策: package.json、exports、実際のインストール結果を確認して両SDKを0.1.1に完全固定。CSSはWebエントリによる読込を使用。
- 追加価値: 高い。汎用エンジン機能の追加は不要。
- 提案: リリース時にREADMEの版・公開状態を検査し、npm/Vite最小テンプレートにPages base、型検査、dispose、CSSを含める。

### 2. Canvas HUDとWorld Viewportの連動例

- 実現したいこと: 人物選択HUDの下だけをマップ表示・ポインター入力に使う。
- 制約: Canvas UIはCSS寸法、Worldは論理解像度。公開setViewportで実現できるが、HUD高と余白をResizeObserverで共有する必要がある。
- 回避策: Boardが要素サイズを監視し、上64px・下32pxを除くViewportを設定。PointerClickのworld座標をTilemap.worldToTileへ渡す。Scene破棄でObserverを解除。
- 追加価値: 中。まず使用例の充実が適切。
- 提案: CanvasNode.boundsとViewportを接続する公式サンプル、または所有者付きサイズ監視ヘルパー。ゲーム固有のHUD高をCoreへ追加しない。

### 3. Canvas / DOM併用時のフォーカス方針

- 実現したいこと: Canvasの人物選択と、長い命令リスト・日本語フォームをキーボードとタッチで一緒に操作する。
- 制約: Canvasのセマンティックミラーは人物選択を扱えるが、任意のTilemapセルへのキーボード移動や、DOM命令行を再生成した後のフォーカス先はアプリ側で決める必要がある。現SDKにSelectや数値入力があっても複雑な命令編集全体を移す利点は小さい。
- 回避策: マップ本体に限定した矢印キー処理、対象座標のaria-live表示、命令並べ替え・削除後のフォーカス復帰を実装。数値入力とスクロールリストはDOMで維持。
- 追加価値: 中。任意のゲーム規則を扱う巨大なウィジェットより、併用ガイドが有用。
- 提案: CanvasミラーとDOMフォームのTab順序、キー所有権、フォーカス復帰の小さな公式例を用意する。

### 4. 離散世界の表示Tweenを安全に置き換える例

- 実現したいこと: 確定した整数座標間を自然に描画し、手動連打や再実行でも古い演出を残さない。
- 制約: TransformそのものへTweenを適用すると表示と状態の区別が曖昧になる。actorTweenは描画専用チャネルを提供するが、複数人物と脱出フェードを同じ進捗で扱う場合には一つの表示進捗が簡潔。
- 回避策: Boardの表示進捗へ明示的Tween.bindを作り、Scene.presentationTweensで再生。旧Tweenをfinishしてから新しいimmutableな始点・終点を設定し、同じ進捗で人物位置と脱出opacityを描画。所有者はScene。
- 追加価値: 高いが、現公開APIで実現できる。
- 提案: 確定状態を変えない表示補間、即時再実行、Tween置換・破棄を含むターン制サンプル。ゲーム専用の命令VMや競合解決器は不要。

### 5. 再配布ライセンスの組み立て例

- 実現したいこと: 静的ゲームに同梱する実行依存すべてのライセンス文面を生成する。
- 制約: SDKにはMITのLICENSEがあるが、推移依存`@pixi/colord@2.9.6`のnpm配布物にはライセンス本文が含まれていない。
- 回避策: lockfileの実行依存を列挙して本文を連結し、この依存だけ固定MIT文面をthird-partyに保持。SDKソースの保管は不要。
- 追加価値: 中。SDK本体の機能より配布ガイドの課題。
- 提案: npmゲーム用テンプレートにNOTICE生成例を設け、推移依存の不足文面と出典を明示する。
