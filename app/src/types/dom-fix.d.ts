/// <reference lib="dom" />

// Fix para @types/react@19.2.14 que sobrescreve HTMLElement com uma
// declaração vazia, removendo propriedades DOM (style, scrollHeight, etc.).
// Este arquivo força o merge correto trazendo as mixins de volta.
declare interface HTMLElement extends ElementCSSInlineStyle, ElementContentEditable, GlobalEventHandlers, HTMLOrSVGElement {}
declare interface HTMLTextAreaElement extends HTMLElement {}
declare interface HTMLDivElement extends HTMLElement {}
declare interface HTMLInputElement extends HTMLElement {}
declare interface HTMLSelectElement extends HTMLElement {}
declare interface HTMLButtonElement extends HTMLElement {}
