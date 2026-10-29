import { Game, defineEvent } from '@simpludify/web';
import { Board } from './board';
import { commandText, emptyPlan, initialWorld, same, startRun, stepRun, type Command, type Direction, type LogEntry, type Plan, type Point, type Run } from './model';
import { collisionExample, solution, stage } from './stage';
import './style.css';

const root = document.querySelector<HTMLElement>('#app')!;
root.innerHTML = `
<header class="topbar"><a class="brand" href="./" aria-label="Run To Exit ホーム"><span class="brand-icon">↱</span><span>RUN TO EXIT<small>COOPERATIVE PLANNING PUZZLE</small></span></a><span class="edition">PROTOTYPE 01 <span class="live-dot"></span></span><a href="https://github.com/oz-coden/Run-To-Exit" target="_blank" rel="noopener" class="repo-link">GitHub ↗</a></header>
<main>
  <div class="intro"><div><p class="eyebrow">PLAN TOGETHER. LEAVE TOGETHER.</p><h1>ふたりで、出口へ。</h1><p>命令を組み、同時に動く。脱出のカギは、タイミング。</p></div><div class="mission"><span class="mission-number">01</span><div><b>ふたつの合図</b><small>S1 と S2 を同時に操作 → ゲート開放 6 ステップ</small></div></div></div>
  <div class="workspace">
    <section class="map-panel panel" aria-label="ステージと実行操作">
      <div class="panel-heading"><h2><span class="eyebrow">BUILDING MAP</span>脱出フロア</h2><span class="pill" id="status" role="status">計画中</span></div>
      <div id="board" aria-label="脱出フロア。Aは(2,3)、Bは(2,5)。スイッチS1は(2,2)、S2は(2,6)、扉は(5,3)、出口は(8,3)。中央の壁は扉だけ通れます。"></div>
      <div class="legend"><span><i class="legend-a"></i>A アオ</span><span><i class="legend-b"></i>B ベニ</span><span><i class="legend-switch"></i>S1 / S2</span><span><i class="legend-exit"></i>出口</span><span id="gate-status">ゲート：閉鎖</span></div>
      <div class="transport"><button id="play" class="primary" disabled>▶ 再生開始</button><button id="step" disabled>1 ステップ →</button><button id="restart" title="編集中の計画を初期状態から実行">↻ 再実行</button><label class="speed-label">速度<select id="speed" aria-label="再生速度"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label></div>
      <p id="run-note" class="note">人物を選び、右のパネルから命令を追加しよう。</p>
      <div id="outcome" hidden tabindex="-1"></div>
      <details class="guide" open><summary>はじめての脱出計画 <span>遊び方</span></summary><ol><li><b>A・B それぞれに命令を追加。</b>まず近くのスイッチを操作してみよう。</li><li><b>再生か1ステップで、全員が同時に行動。</b>スイッチの効果は翌ステップから。</li><li><b>ゲートが開いている間に、2人を出口へ。</b>同じマスへの進入や、前の人への追従には待機を使おう。</li></ol><p>操作範囲は同じマスか上下左右の隣。条件待機の解除にも1ステップ使うよ。マスの座標は左上が (0,0)。</p><details><summary>ヒント・攻略例</summary><p>Aは先に中央通路を進み、Bは右へ2マス、上へ2マス進んでから追いかけると、混雑を避けられる。</p><button id="load-solution">攻略例をセット</button><button id="load-conflict">衝突例をセット</button><p class="note">この2つのボタンは編集中の命令を置き換えます。</p></details></details>
    </section>
    <section class="editor panel" aria-labelledby="plan-title">
      <div class="panel-heading"><h2 id="plan-title"><span class="eyebrow">YOUR PROGRAM</span>行動を計画する</h2><span id="draft-badge" class="pill">編集中</span></div>
      <div class="character-tabs" role="group" aria-label="命令を編集する人物"><button data-person="A" aria-pressed="true"><span class="avatar a">A</span><span>アオ<small id="pos-A">(2, 3)</small></span><span class="command-count" id="count-A">0</span></button><button data-person="B" aria-pressed="false"><span class="avatar b">B</span><span>ベニ<small id="pos-B">(2, 5)</small></span><span class="command-count" id="count-B">0</span></button></div>
      <p class="selected-title"><b id="selected-name">A アオ</b> の次回実行する計画 <span id="selected-cell">対象 (8, 3)</span></p>
      <ol id="commands" class="commands" aria-label="編集中の命令列"></ol>
      <div class="builder"><label>追加する命令<select id="command-kind"><option value="move">方向へ移動</option><option value="go">座標まで自動移動</option><option value="interact">設備を操作</option><option value="wait">ステップ数で待機</option><option value="until">条件が成立するまで待機</option></select></label>
        <div id="move-fields" class="fields"><label>方向<select id="direction"><option value="up">↑ 上</option><option value="right">→ 右</option><option value="down">↓ 下</option><option value="left">← 左</option></select></label><label>マス数<input id="move-count" type="number" min="1" max="50" value="1" inputmode="numeric"></label></div>
        <div id="go-fields" class="fields" hidden><label>X 座標<input id="target-x" type="number" min="0" max="10" value="8" inputmode="numeric"></label><label>Y 座標<input id="target-y" type="number" min="0" max="7" value="3" inputmode="numeric"></label><p class="field-note">マップをタップしても指定できます。</p></div>
        <div id="interact-fields" hidden><label>スイッチ<select id="device"><option value="s1">S1 · (2, 2)</option><option value="s2">S2 · (2, 6)</option></select></label></div>
        <div id="wait-fields" hidden><label>待機するステップ数<input id="wait-count" type="number" min="1" max="100" value="1" inputmode="numeric"></label></div>
        <div id="until-fields" hidden><label>待つ条件<select id="condition"><option value="open">ゲートが開く</option><option value="closed">ゲートが閉じる</option><option value="escaped">もう1人が脱出する</option><option value="at">もう1人が指定座標に来る</option></select></label><div id="condition-position" class="fields" hidden><label>待機対象 X<input id="condition-x" type="number" min="0" max="10" value="4"></label><label>待機対象 Y<input id="condition-y" type="number" min="0" max="7" value="3"></label></div><p class="field-note">条件の判定と解除に1ステップ。その翌ステップに次の命令へ。</p></div>
        <p id="edit-error" role="alert" hidden></p><button id="add-command" class="add-button">＋ 命令を追加</button>
      </div>
      <details class="snapshot"><summary>現在実行中の計画 <span id="snapshot-state">未実行</span></summary><div id="snapshot-content">再生開始時に計画を固定します。</div></details>
    </section>
  </div>
  <section class="log-panel panel" aria-labelledby="log-title"><div class="panel-heading"><h2 id="log-title"><span class="eyebrow">EXECUTION TRACE</span>実行ログ</h2><label class="log-filter">表示<select id="log-filter"><option value="important">重要イベント</option><option value="all">すべて</option></select></label></div><p class="note">イベントを選ぶと、関係するマスと命令を強調します。</p><div id="log" class="log" tabindex="0" aria-label="実行ログ"><p class="empty-log">まだ実行していません。計画を組んで、はじめの一歩を。</p></div></section>
</main><footer><span>RUN TO EXIT <span class="muted">/</span> ふたり分の計画、ひとつの出口。</span><span>Made with <a href="https://github.com/oz-coden/Simpludify" target="_blank" rel="noopener">Simpludify ↗</a></span></footer>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => $<HTMLInputElement>(id).value;
let draft: Plan = emptyPlan(stage), selected = 'A', run: Run | null = null, playing = false, accumulator = 0;
let board: Board | undefined;
let highlightedCommand: { actor: string; index: number } | null = null;
const initial = initialWorld(stage);
const world = () => run?.state ?? initial;
const StepCommitted = defineEvent<Run>('RunToExit.StepCommitted');
const shutdown = new AbortController();
function listen(id: string, callback: () => void, event = 'click'): void { $(id).addEventListener(event, callback, { signal: shutdown.signal }); }
function select(id: string): void {
  selected = id; board?.select(id); highlightedCommand = null; renderEditor(); board?.focus(run?.conflict?.cells);
}
function pick(point: Point): void {
  $('target-x').setAttribute('value', String(point.x)); $<HTMLInputElement>('target-x').value = String(point.x);
  $<HTMLInputElement>('target-y').value = String(point.y);
  $<HTMLInputElement>('condition-x').value = String(point.x); $<HTMLInputElement>('condition-y').value = String(point.y);
  $('selected-cell').textContent = `対象 (${point.x}, ${point.y})`;
  const device = stage.switches.find(s => same(s, point));
  if (device) { $<HTMLSelectElement>('command-kind').value = 'interact'; $<HTMLSelectElement>('device').value = device.id; }
  else if (!world().people.some(p => !p.escaped && same(p, point))) $<HTMLSelectElement>('command-kind').value = 'go';
  showFields(); board?.focus([point]);
}
function showFields(): void {
  for (const kind of ['move','go','interact','wait','until']) $(`${kind}-fields`).hidden = kind !== value('command-kind');
  $('condition-position').hidden = value('condition') !== 'at'; $('edit-error').hidden = true;
}
function number(id: string, min: number, max: number): number {
  const n = Number(value(id)); if (!Number.isSafeInteger(n) || n < min || n > max || !value(id).trim()) throw new Error(`${min}〜${max} の整数を入力してください。`); return n;
}
function addCommand(): void {
  try {
    if (draft[selected].length >= 50) throw new Error('1人につき50命令まで追加できます。');
    let command: Command;
    switch (value('command-kind')) {
      case 'move': command = { kind: 'move', direction: value('direction') as Direction, count: number('move-count',1,50) }; break;
      case 'go': command = { kind: 'go', x: number('target-x',0,10), y: number('target-y',0,7) }; break;
      case 'interact': command = { kind: 'interact', target: value('device') }; break;
      case 'wait': command = { kind: 'wait', steps: number('wait-count',1,100) }; break;
      default: {
        const other = selected === 'A' ? 'B' : 'A';
        command = { kind: 'until', condition: value('condition') === 'escaped' ? { kind: 'escaped', actor: other } : value('condition') === 'at' ? { kind: 'at', actor: other, x: number('condition-x',0,10), y: number('condition-y',0,7) } : { kind: 'door', door: 'gate', open: value('condition') === 'open' } };
      }
    }
    draft[selected].push(command); highlightedCommand = null; renderEditor(); renderStatus();
  } catch (error) { $('edit-error').textContent = (error as Error).message; $('edit-error').hidden = false; }
}
function icon(command: Command): string {
  return command.kind === 'move' ? ({up:'↑',right:'→',down:'↓',left:'←'})[command.direction] : ({go:'◎',interact:'⌁',wait:'◷',until:'◇'})[command.kind];
}
function renderEditor(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-person]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.person === selected)));
  $('selected-name').textContent = `${selected} ${stage.people.find(p => p.id === selected)!.name}`;
  stage.people.forEach(p => { $(`count-${p.id}`).textContent = `${draft[p.id].length}`; });
  const list = $('commands'); list.replaceChildren();
  if (!draft[selected].length) {
    const empty = document.createElement('li'); empty.className = 'empty-commands'; empty.textContent = 'ここから脱出計画がはじまる。\n下のメニューから命令を追加しよう。'; list.append(empty);
  }
  draft[selected].forEach((command,index) => {
    const li = document.createElement('li'); li.className = 'command'; li.dataset.index = String(index);
    const unchanged = run && JSON.stringify(run.plan[selected]?.[index]) === JSON.stringify(command);
    if (unchanged && world().people.find(p => p.id === selected)?.pc === index && !run?.state.people.find(p => p.id === selected)?.escaped) li.classList.add('current-command');
    if (highlightedCommand?.actor === selected && highlightedCommand.index === index) li.classList.add('highlighted-command');
    const number = document.createElement('span'); number.className = 'line-number'; number.textContent = String(index+1).padStart(2,'0');
    const glyph = document.createElement('span'); glyph.className = `command-icon ${command.kind}`; glyph.textContent = icon(command);
    const label = document.createElement('span'); label.className='command-label'; label.textContent = commandText(command);
    li.append(number,glyph,label);
    for (const [text,title,delta] of [['↑','上へ移動',-1],['↓','下へ移動',1],['×','削除',0]] as const) {
      const button = document.createElement('button'); button.textContent = text; button.title = title; button.setAttribute('aria-label', `命令 ${index+1} を${title}`);
      button.disabled = delta === -1 && index === 0 || delta === 1 && index === draft[selected].length-1;
      button.onclick = () => { const items = draft[selected]; if (!delta) items.splice(index,1); else [items[index],items[index+delta]] = [items[index+delta],items[index]]; highlightedCommand=null; renderEditor(); renderStatus(); };
      li.append(button);
    }
    list.append(li);
  });
  const snapshot = $('snapshot-content'); snapshot.replaceChildren();
  if (run) for (const p of stage.people) {
    const heading = document.createElement('b'); heading.textContent=`${p.id} ${p.name}`; snapshot.append(heading);
    const ol = document.createElement('ol');
    for (const [i,c] of run.plan[p.id].entries()) { const li=document.createElement('li'); li.textContent=commandText(c); if (world().people.find(a => a.id === p.id)?.pc === i) li.className='active-snapshot'; ol.append(li); }
    if (!ol.childElementCount) { const li=document.createElement('li'); li.textContent='命令なし'; ol.append(li); } snapshot.append(ol);
  } else snapshot.textContent='再生開始時に計画を固定します。';
}
function renderStatus(): void {
  const state=world(), changed = run && JSON.stringify(draft)!==JSON.stringify(run.plan);
  $('status').textContent = run?.conflict ? 'Conflict で停止' : state.cleared ? '全員脱出！' : playing ? '実行中' : run ? '一時停止' : '計画中';
  $('status').className = `pill ${run?.conflict ? 'danger' : state.cleared ? 'success' : ''}`;
  $('draft-badge').textContent=changed ? '次回用の変更あり' : '編集中'; $('draft-badge').classList.toggle('changed',!!changed);
  $('snapshot-state').textContent=run ? `Step ${state.step} / 固定済み` : '未実行';
  $<HTMLButtonElement>('play').disabled=!!run?.conflict||state.cleared;
  $<HTMLButtonElement>('step').disabled=!!run?.conflict||state.cleared;
  $('play').textContent=playing ? 'Ⅱ 一時停止' : run ? '▶ 再開' : '▶ 再生開始';
  const door=state.doors[0]; $('gate-status').textContent=door.open ? `次の Step ${state.step+1}：開放 / ${door.until} まで` : `次の Step ${state.step+1}：ゲート閉鎖`;
  stage.people.forEach(p => { const actor=state.people.find(a=>a.id===p.id)!; $(`pos-${p.id}`).textContent=actor.escaped?'脱出済み':`(${actor.x}, ${actor.y})`; });
  $('run-note').textContent=changed ? '編集中の変更は、↻ 再実行から適用されます。現在の実行計画は固定済み。' : run ? `世界 Step ${state.step}。実行計画は固定済み。編集は次回に適用。` : '人物を選び、命令を追加しよう。初期状態から全員同時に動きます。';
  const outcome=$('outcome'); outcome.hidden = !run?.conflict && !state.cleared; outcome.replaceChildren();
  if (run?.conflict) {
    outcome.className='outcome conflict'; const c=run.conflict, title=document.createElement('h3'); title.textContent=`Step ${c.step}：${c.kind}`;
    const text=document.createElement('p'); text.textContent=c.message;
    const detail=document.createElement('p'); detail.className='note'; detail.textContent=`関係者 ${c.actors.join('・') || '設備'} / ${c.cells.map(p=>`(${p.x}, ${p.y})`).join(' ')} / 最後に確定した Step ${state.step}`;
    const commands=document.createElement('p'); commands.className='note'; commands.textContent=c.commands.map(c=>`${c.actor} 命令${c.index+1}：${c.command?commandText(c.command):'命令なし'}`).join(' / ');
    outcome.append(title,text,detail,commands); board?.focus(c.cells);
  } else if (state.cleared) {
    outcome.className='outcome clear'; const heading=document.createElement('h3'); heading.textContent='計画成功。全員、無事に脱出！';
    const text=document.createElement('p'); text.textContent=`${state.step} ステップでクリア。別の命令や待機でも、脱出計画を試してみよう。`; outcome.append(heading,text);
  }
}
function renderLog(): void {
  const log=$('log'), nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<70;
  log.replaceChildren();
  const entries=(run?.logs??[]).filter(l=>value('log-filter')==='all'||!['start','complete','move','wait'].includes(l.kind));
  if (!entries.length) { const p=document.createElement('p'); p.className='empty-log'; p.textContent=run?'重要イベントはまだありません。「すべて」で移動や待機を確認できます。':'まだ実行していません。計画を組んで、はじめの一歩を。'; log.append(p); }
  for (const entry of entries) {
    const button=document.createElement('button'); button.className=`log-entry log-${entry.kind}`;
    const step=document.createElement('span'); step.className='log-step'; step.textContent=String(entry.step).padStart(2,'0');
    const who=document.createElement('span'); who.className='log-who'; who.textContent=entry.actors.join('・')||'SYS';
    const text=document.createElement('span'); text.textContent=entry.text; button.append(step,who,text);
    button.onclick=()=>focusLog(entry); log.append(button);
  }
  if (nearBottom) log.scrollTop=log.scrollHeight;
}
function focusLog(entry: LogEntry): void {
  const actor=entry.actors[0]; if (actor) select(actor);
  highlightedCommand=actor&&entry.command!==undefined ? {actor,index:entry.command} : null;
  renderEditor(); board?.focus(entry.cells);
  $('commands').querySelector('.highlighted-command')?.scrollIntoView({block:'nearest'});
}
function newRun(): void {
  run=startRun(stage,draft); accumulator=0; highlightedCommand=null; board?.sync(run.state,false); board?.focus(); renderEditor(); renderStatus(); renderLog();
}
function takeStep(animate=true): void {
  if (!run) newRun();
  run=stepRun(run!);
  if (run.conflict||run.state.cleared) playing=false;
  board?.sync(run.state,animate,.25/Number(value('speed')));
  if (run.conflict) board?.focus(run.conflict.cells); else board?.focus();
  game.engine.scene.events.emit(StepCommitted,run);
}
listen('play',()=>{ if (!run) newRun(); playing=!playing; accumulator=0; renderStatus(); });
listen('step',()=>{ playing=false; accumulator=0; takeStep(false); });
listen('restart',()=>{ playing=false; newRun(); playing=true; renderStatus(); });
listen('add-command',addCommand); listen('command-kind',showFields,'change'); listen('condition',showFields,'change');
listen('speed',()=>{accumulator=0;},'change'); listen('log-filter',renderLog,'change');
for (const [id,plan] of [['load-solution',solution],['load-conflict',collisionExample]] as const) listen(id,()=>{
  draft=structuredClone(plan); highlightedCommand=null; renderEditor(); renderStatus();
});
document.querySelectorAll<HTMLButtonElement>('[data-person]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.person!),{signal:shutdown.signal}));
const game=new Game({parent:$('board'),resolution:{width:640,height:448},tokens:{background:'#152936'},onError:error=>{playing=false; $('run-note').textContent=`ゲームの起動または描画に失敗しました：${String(error)}`;}});
game.element.setAttribute('aria-label','脱出フロア。Tabキーで人物を選択できます。');
game.scene('puzzle',context=>{
  board=new Board(game,context,stage,initial,select,pick); board.select(selected); board.focus();
  context.scene.events.on(StepCommitted,()=>{renderEditor();renderStatus();renderLog();});
  context.onUpdate(seconds=>{
    if (!playing||document.hidden) return;
    accumulator+=seconds;
    const interval=.65/Number(value('speed'));
    // Pace affects when steps are requested, never the integer state transition.
    if (accumulator>=interval) { accumulator-=interval; takeStep(); if (world().step>=200) { playing=false; renderStatus(); $('run-note').textContent='200ステップに到達して一時停止。条件や命令列を確認してください。1ステップ操作は続けられます。'; } }
  });
  context.onDispose(()=>shutdown.abort());
});
try { await game.run('puzzle'); renderEditor(); renderStatus(); }
catch (error) { $('run-note').textContent=`起動できませんでした：${String(error)}`; }
window.addEventListener('pagehide',event=>{if (!event.persisted) game.dispose();},{signal:shutdown.signal});
if (import.meta.hot) import.meta.hot.dispose(()=>game.dispose());
