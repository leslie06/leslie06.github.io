/**
 * Language plumbing for ui/. `L()` makes a text node that re-translates itself when the player
 * switches language: for the menus and HUD labels that are built once and live for the session
 * (a node made with `L()` is never released, so don't use it for transient rows). Text rewritten
 * every frame (reload prompt, objective line) just calls `t()` and needs nothing from here.
 */
import { t, onLangChange, type TKey, type TParams } from '../core/I18n';

const bound: { node: Text; key: TKey; params?: TParams }[] = [];
onLangChange(() => { for (const b of bound) b.node.data = t(b.key, b.params); });

export function L(key: TKey, params?: TParams): Text {
  const node = document.createTextNode(t(key, params));
  bound.push({ node, key, params });
  return node;
}
