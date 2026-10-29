# Simpludify公開APIの利用レビュー

対象: `152ec2e35789ec512f53ea988d7f0d54d7ff1ead`。ゲームは公開exportのみを利用し、エンジン本体を変更していない。

## 実際に利用した機能

GridのinBounds/get、Tilemap/SpriteSheet、Actor/Transform/Renderable、Game/Scene、CanvasButton/Row/Column/Label/Panel、PointerClick、defineEvent/Scene.events、setViewport、起動とdisposeを利用した。Gridのインデックスとworld座標の境界を明示でき、人物の同時更新は描画と独立して構築できた。

## 具体的な改善候補

### 1. 必要なパッケージだけを固定して生成するゲーム用コマンド

```sh
npm run create -- ../my-game
```

現状はエンジンのテスト、ベンチマーク、サイト、全サンプル、文書までコピーする。独立ゲームでは不要な内容の除去と、エントリ・Vite・テスト設定の再構成が必要だった。今回も生成後にCore/Webだけを選んでゲームのtoolchainを作成した。

改善案: `create --template game --engine-commit <sha>` のような最小構成を提供し、出典・固定ソース・lockfile・Pages base指定・起動コードを生成する。公開SDK化は今回のゲームの前提にしない。

### 2. Canvasの相対パネルとワールド用Viewportの連動

```ts
const resize = () => game.setViewport({
  x: 0, y: 64,
  width: game.element.clientWidth,
  height: game.element.clientHeight - 96,
});
const observer = new ResizeObserver(resize);
observer.observe(game.element);
context.onDispose(() => observer.disconnect());
```

Canvas UIはCSS寸法、Worldは論理解像度なので、HUDの下だけをマップ入力にするにはこの連動処理が必要だった。公開APIで実現可能だが、HUD高や余白の共有が手作業になる。

改善案: CanvasNode.boundsとViewportの接続例、または所有者に紐づくサイズ監視の補助APIを公式サンプルに追加する。ゲームごとの固定HUD高をCoreへ持ち込む必要はない。

### 3. 長い命令リストはDOM併用が適している

```ts
context.canvasUI(CanvasColumn([
  CanvasRow(characterButtons, { gap: 8 }),
  CanvasPanel([], { grow: 1 }),
  CanvasLabel('人物を選択 → マスをタップ'),
]));
```

Canvasの人物選択はマップに自然に統合できる。一方でスクロール、数値フォーム、命令の並べ替え、テキストログはDOMの方が小さなコードでキーボード操作まで扱える。現APIの責務分離に従い、Canvasに独自スクロールエディタを実装しなかった。

改善案: CanvasとDOMの併用例とフォーカス移動のガイドを充実させる。Canvasにブラウザのフォーム機能を丸ごと再実装する提案ではない。

### 4. 固定ステップとは別に、離散世界を制御する例

```ts
const result = advance(stage, snapshotPlan, world);
if (result.ok) world = result.state;
```

整数ステップとトランザクションはRun To Exit側の規則。Scene.after/everyは秒単位なので設備の期限に使うとゲームの整数時間と結びつける追加コードが必要になる。Gridパズル向けに「Scene.onUpdateは表示のペース、世界更新は純粋関数」という短い公式例があると導入しやすい。

改善案: 固定フレームを使う例に加えて、ターン制・命令実行型のサンプルを用意する。汎用の競合解決器や命令VMをエンジンに追加する必要はない。
