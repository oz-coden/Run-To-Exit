import type { Graphics, Text } from "pixi.js";

interface Hash {
  items: Record<string, unknown>;
}
interface PinnedRenderer {
  renderPipes: {
    graphics?: { _managedGraphics?: Hash };
    text?: { _managedTexts?: Hash };
  };
  graphicsContext?: { _managedContexts?: Hash };
  canvasText?: { _activeTextures?: Record<string, unknown> };
}
function drop(
  hash: Hash | undefined,
  id: number,
  resource?: Graphics | Text,
): void {
  if (!hash) return;
  const value = hash.items[id];
  if (value === null || (resource?.destroyed && value === resource))
    delete hash.items[id];
}
/** Renderer-local compatibility for pinned Pixi8.22. Drop only destroyed UI owners/null bookkeeping.
 * CanvasGraphicsPipe has no GPU data for its Graphics; GCManagedHash.remove returns early there.
 * Text/style keys otherwise accumulate null entries after dynamic text updates. */
export function releaseUIGraphics(
  renderer: unknown,
  graphics: Graphics,
  context: number | undefined,
): void {
  if (!graphics.destroyed) return;
  const r = renderer as PinnedRenderer;
  drop(r.renderPipes.graphics?._managedGraphics, graphics.uid, graphics);
  if (context !== undefined) drop(r.graphicsContext?._managedContexts, context);
}
export function releaseUIText(
  renderer: unknown,
  text: Text,
  key: string | undefined,
): void {
  if (!text.destroyed) return;
  const r = renderer as PinnedRenderer;
  drop(r.renderPipes.text?._managedTexts, text.uid, text);
  if (key !== undefined && r.canvasText?._activeTextures?.[key] === null)
    delete r.canvasText._activeTextures[key];
}
/** Called after rendering so replaced text has released its old managed texture. Never drops a live key. */
export function pruneUITextKeys(renderer: unknown, keys: Set<string>): void {
  const textures = (renderer as PinnedRenderer).canvasText?._activeTextures;
  for (const key of keys) {
    if (textures?.[key] != null) continue;
    if (textures?.[key] === null) delete textures[key];
    keys.delete(key);
  }
}
