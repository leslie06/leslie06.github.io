import { t, onLangChange, type TKey, type TParams } from '../core/I18n';

const bound: { node: Text; key: TKey; params?: TParams }[] = [];
onLangChange(() => { for (const b of bound) b.node.data = t(b.key, b.params); });

/** A text node that re-translates itself when the language changes (for labels built once). */
export function L(key: TKey, params?: TParams): Text {
  const node = document.createTextNode(t(key, params));
  bound.push({ node, key, params });
  return node;
}
