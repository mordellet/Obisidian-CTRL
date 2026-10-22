// Minimal stand-in for the obsidian API so the view can be rendered under jsdom.
type Opts = { cls?: string; text?: string; type?: string; placeholder?: string; attr?: Record<string, string> };

export function installDomHelpers(): void {
	const P = Element.prototype as unknown as Record<string, unknown>;
	P.empty = function (this: Element) {
		this.innerHTML = '';
	};
	P.addClass = function (this: Element, ...c: string[]) {
		this.classList.add(...c.flatMap((x) => x.split(' ').filter(Boolean)));
	};
	P.removeClass = function (this: Element, ...c: string[]) {
		this.classList.remove(...c);
	};
	P.toggleClass = function (this: Element, c: string, v: boolean) {
		this.classList.toggle(c, v);
	};
	P.setText = function (this: Element, t: string) {
		this.textContent = t;
	};
	P.createEl = function (this: Element, tag: string, o: Opts = {}) {
		const e = document.createElement(tag) as HTMLInputElement;
		if (o.cls) e.className = o.cls;
		if (o.text !== undefined) e.textContent = o.text;
		if (o.type) e.type = o.type;
		if (o.placeholder) e.placeholder = o.placeholder;
		for (const [k, v] of Object.entries(o.attr ?? {})) e.setAttribute(k, v);
		this.appendChild(e);
		return e;
	};
	P.createDiv = function (this: Element & { createEl: (t: string, o?: Opts) => HTMLElement }, o: Opts = {}) {
		return this.createEl('div', o);
	};
	P.createSpan = function (this: Element & { createEl: (t: string, o?: Opts) => HTMLElement }, o: Opts = {}) {
		return this.createEl('span', o);
	};
}

export class ItemView {
	contentEl: HTMLElement;
	app = { workspace: { openLinkText: () => undefined } };
	scope = { register: () => undefined };
	constructor(readonly leaf: unknown) {
		this.contentEl = document.createElement('div');
		document.body.appendChild(this.contentEl);
	}
}
export class Notice {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export const debounce = <T>(f: T): T => f;
