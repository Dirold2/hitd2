import { parse, type HTMLElement } from "node-html-parser";

export type HtmlElement = HTMLElement;

export function parseHtml(html: string): HtmlElement {
  return parse(html);
}
