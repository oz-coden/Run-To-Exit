import { Game, CanvasColumn, CanvasLabel } from '@simpludify/web';
const host = document.querySelector<HTMLElement>('#app')!;
host.style.height = '90vh'; host.textContent = '';
const game = new Game({ parent: host });
game.scene('plan', ({ canvasUI }) => { canvasUI(CanvasColumn([CanvasLabel('Run To Exit')], { padding: 24 })); });
await game.run('plan');
if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
