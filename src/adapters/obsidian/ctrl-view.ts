// Board view (Stufe 0 radial + Detail + Statuszeile + Nicht zugeordnet).
import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import { addDays, daysBetween } from '../../domain/dates';
import type { BoardData, BoardEvent, Question, Step, Topic } from '../../domain/model';
import { STATUS_KWS } from '../../domain/model';
import { allSteps, chain, computeSignals, type Signals } from '../../domain/signals';
import { parseStatusInput } from '../../domain/status-input';
import type { BoardService } from '../../application/board-service';
import type { Clock } from '../../ports/board';

export const VIEW_TYPE_CTRL = 'ctrl-board';

const SVGNS = 'http://www.w3.org/2000/svg';
const C = { x: 430, y: 390 };
const R0 = 60;
const RMAX = 196;

type Attrs = Record<string, string | number>;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs, parent?: Element): SVGElementTagNameMap[K] {
	const e = document.createElementNS(SVGNS, tag);
	for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
	parent?.appendChild(e);
	return e;
}

function pol(r: number, deg: number): [number, number] {
	const a = (deg * Math.PI) / 180;
	return [C.x + r * Math.sin(a), C.y - r * Math.cos(a)];
}

function sectorPath(r1: number, r2: number, a0: number, a1: number): string {
	const large = a1 - a0 > 180 ? 1 : 0;
	const [x0, y0] = pol(r2, a0);
	const [x1, y1] = pol(r2, a1);
	const [x2, y2] = pol(r1, a1);
	const [x3, y3] = pol(r1, a0);
	return `M${x0},${y0} A${r2},${r2} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r1},${r1} 0 ${large} 0 ${x3},${y3} Z`;
}

function arrow(x: number, y: number, ang: number, len: number): string {
	const a = (ang * Math.PI) / 180;
	const ex = x + len * Math.cos(a);
	const ey = y + len * Math.sin(a);
	const h = 4;
	const l = a + Math.PI * 0.8;
	const r = a - Math.PI * 0.8;
	return `M ${x} ${y} L ${ex} ${ey} M ${ex + h * Math.cos(l)} ${ey + h * Math.sin(l)} L ${ex} ${ey} L ${ex + h * Math.cos(r)} ${ey + h * Math.sin(r)}`;
}

function arcPath(r: number, a0: number, a1: number): string {
	const [x0, y0] = pol(r, a0);
	const [x1, y1] = pol(r, a1);
	return `M${x0},${y0} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1},${y1}`;
}

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const mmdd = (d: string) => d.slice(5);
const KIND_MARK: Record<Question['kind'], string> = { entscheidung: '!', frage: '?', risiko: 'r' };

export class CtrlView extends ItemView {
	private data: BoardData | null = null;
	private sig = new Map<string, Signals>();
	private sel: string | null = null;
	private mode: 'jahr' | '28' = 'jahr';
	private demo = false;
	private hint = '';
	private draft = '';
	/** Zoom: stage 0 = Übersicht, 1 = Explosion (pin), focus = Stufe 2 Graph. */
	private stage: 0 | 1 = 0;
	private pin: string | null = null;
	private focus: string | null = null;
	private acc = 0;
	private lock = 0;
	private cam = 'translate(0px, 0px) scale(1)';
	/** Zeitreihe: t = Tage vor heute (Modus 28 d), Play läuft von 320 → 0. */
	private t = 0;
	private playing = false;
	private timer: number | null = null;
	/** gewählter Schritt / Ziel (`topicId|stepId` bzw. Ziel-ID) */
	private selStep: { topic: string; id: string } | null = null;
	private adding: string | null = null;
	private bodyEl: HTMLElement | null = null;
	private refLabel: HTMLElement | null = null;
	private retries = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly live: BoardService,
		private readonly demoService: BoardService,
		private readonly clock: Clock,
		private readonly defaultStale: () => number,
	) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_CTRL;
	}
	getDisplayText() {
		return 'CTRL';
	}
	getIcon() {
		return 'radar';
	}

	async onOpen() {
		this.scope?.register([], 'Escape', () => {
			this.back();
			return false;
		});
		await this.refresh();
	}

	private get service(): BoardService {
		return this.demo ? this.demoService : this.live;
	}
	private get baseToday(): string {
		return this.demo ? '2026-10-21' : this.clock.today();
	}
	/** Referenzzeitpunkt: heute oder Reglerposition (nur im 28-d-Modus). */
	private get today(): string {
		return this.mode === '28' ? addDays(this.baseToday, -this.t) : this.baseToday;
	}

	async refresh() {
		try {
			this.data = await this.service.load();
		} catch (e) {
			this.hint = `load failed · ${(e as Error).message}`;
		}
		// metadata index not ready yet right after start → retry a few times
		if (!this.demo && this.data && !this.data.topics.length && this.retries < 8) {
			this.retries++;
			window.setTimeout(() => void this.refresh(), 750);
		} else this.retries = 0;
		this.draw();
	}

	async onClose() {
		this.stopPlay();
	}

	private stopPlay() {
		this.playing = false;
		if (this.timer !== null) window.clearInterval(this.timer);
		this.timer = null;
	}

	private togglePlay() {
		if (this.playing) {
			this.stopPlay();
			this.draw();
			return;
		}
		this.mode = '28';
		if (this.t <= 0) this.t = 320;
		this.playing = true;
		this.timer = window.setInterval(() => {
			this.t = Math.max(0, this.t - 3);
			if (this.t === 0) this.stopPlay();
			this.drawBody();
		}, 120);
		this.draw();
	}

	private get win() {
		return this.mode === 'jahr' ? 365 : 28;
	}
	private get staleDays() {
		return this.data?.main?.staleDays ?? this.defaultStale();
	}
	private visibleTopics(): Topic[] {
		return (this.data?.topics ?? []).sort((a, b) => a.prio - b.prio);
	}
	private topic(id: string | null) {
		return this.visibleTopics().find((t) => t.id === id);
	}
	private openNote(path: string) {
		if (this.demo) return;
		void this.app.workspace.openLinkText(path, '', 'tab');
	}

	private async write(fn: () => Promise<unknown>) {
		try {
			const r = await fn();
			if (r === false) this.hint = 'write conflict · datei geändert · neu laden';
		} catch (e) {
			this.hint = `write failed · ${(e as Error).message}`;
		}
		await this.refresh();
	}

	/** Esc / Rad heraus: eine Stufe zurück. */
	private back() {
		if (this.focus) {
			this.pin = this.focus;
			this.stage = 1;
			this.focus = null;
		} else if (this.stage === 1) {
			this.stage = 0;
			this.pin = null;
		} else {
			this.sel = null;
			this.selStep = null;
		}
		this.draw();
	}

	private deeper(id: string | null) {
		if (this.focus) return;
		if (this.stage === 0 && id) {
			this.stage = 1;
			this.pin = id;
			this.sel = id;
		} else if (this.stage === 1 && this.pin) {
			this.focus = this.pin;
			this.sel = this.pin;
			this.stage = 0;
			this.pin = null;
		}
		this.draw();
	}

	private onWheel(e: WheelEvent, over: () => string | null) {
		e.preventDefault();
		const now = Date.now();
		// one gesture = one stage: after a step, every further wheel event (trackpad inertia)
		// extends the lock; only a pause of 250 ms ends the gesture
		if (now < this.lock) {
			this.lock = now + 250;
			return;
		}
		this.acc += e.deltaY * (e.ctrlKey ? 5 : 1);
		if (Math.abs(this.acc) < 90) return;
		const dir = this.acc;
		this.acc = 0;
		this.lock = now + 450;
		if (dir < 0) this.deeper(over() ?? this.sel);
		else if (this.focus || this.stage === 1) this.back();
	}

	draw() {
		const root = this.contentEl;
		root.empty();
		root.addClass('ctrl');
		const data = this.data;
		if (!data) {
			root.createDiv({ cls: 'ctrl-empty', text: this.hint || 'lade …' });
			return;
		}
		this.renderHeader(root);
		this.renderStatusLine(root);
		this.bodyEl = root.createDiv({ cls: 'ctrl-body-wrap' });
		this.drawBody();
	}

	/** Re-renders stage + unassigned only (keeps header controls, e.g. while dragging the slider). */
	drawBody() {
		const data = this.data;
		const root = this.bodyEl;
		if (!data || !root) return;
		root.empty();
		if (this.refLabel) this.refLabel.setText(this.mode === '28' ? `${this.today} · 28 d` : 'gesamt · 365 d');
		const topics = this.visibleTopics();
		this.sig = computeSignals(topics, data.events, { ref: this.today, win: this.win, staleDays: this.staleDays });
		const stage = root.createDiv({ cls: 'ctrl-stage' });
		const netCard = stage.createDiv({ cls: 'ctrl-card ctrl-net-card' });
		const focusTopic = this.topic(this.focus);
		if (focusTopic) this.renderGraph(netCard, focusTopic, topics);
		else {
			this.focus = null;
			this.renderNet(netCard, topics);
		}
		this.renderDetail(stage.createDiv({ cls: 'ctrl-card ctrl-detail' }), topics);
		this.renderUnassigned(root);
	}

	// ── header ─────────────────────────────────────────────
	private renderHeader(root: HTMLElement) {
		const h = root.createDiv({ cls: 'ctrl-head' });
		const crumbs = h.createDiv({ cls: 'ctrl-crumbs' });
		const t = this.topic(this.focus ?? this.pin ?? this.sel);
		const all = crumbs.createSpan({ text: 'Alle Themen', cls: t ? 'ctrl-link' : 'ctrl-strong' });
		all.onclick = () => {
			this.sel = this.pin = this.focus = null;
			this.stage = 0;
			this.draw();
		};
		if (t) {
			crumbs.createSpan({ text: ' › ', cls: 'ctrl-mono ctrl-muted' });
			crumbs.createSpan({ text: `${t.id} ${t.name}`, cls: 'ctrl-strong' });
		}
		const level = this.focus ? 'stufe 2 · graph' : this.stage === 1 ? 'stufe 1 · explosion' : 'stufe 0 · übersicht';
		crumbs.createSpan({ text: `   ${level}`, cls: 'ctrl-mono ctrl-muted ctrl-small' });
		const main = this.data?.main?.mainTrack;
		if (main) crumbs.createSpan({ text: `   main · ${main}`, cls: 'ctrl-mono ctrl-muted ctrl-small' });
		const right = h.createDiv({ cls: 'ctrl-head-right' });
		// Zeitreihe: Jahr = Gesamtsicht · Regler/Play = 28-Tage-Fenster wandert durch das Jahr
		const tl = right.createDiv({ cls: 'ctrl-timeline' });
		const year = tl.createEl('button', { text: 'jahr', cls: this.mode === 'jahr' ? 'is-active' : '' });
		year.onclick = () => {
			this.stopPlay();
			this.mode = this.mode === 'jahr' ? '28' : 'jahr';
			this.draw();
		};
		const play = tl.createEl('button', { text: this.playing ? '❚❚' : '▶', cls: 'ctrl-play' + (this.playing ? ' is-playing' : ''), attr: { 'aria-label': 'Wiedergabe 28-Tage-Fenster' } });
		play.onclick = () => this.togglePlay();
		const slider = tl.createEl('input', { type: 'range', cls: 'ctrl-slider' });
		slider.min = '0';
		slider.max = '320';
		slider.value = String(320 - this.t);
		slider.oninput = () => {
			this.stopPlay();
			if (this.mode !== '28') {
				this.mode = '28';
				year.removeClass('is-active');
			}
			this.t = 320 - Number(slider.value);
			this.drawBody();
		};
		this.refLabel = tl.createSpan({ cls: 'ctrl-mono ctrl-small ctrl-ref' + (this.mode === '28' ? '' : ' ctrl-muted') });
		const d = right.createEl('button', { text: this.demo ? 'demo · an' : 'demo · aus', cls: 'ctrl-btn' + (this.demo ? ' is-active' : '') });
		d.onclick = () => {
			this.demo = !this.demo;
			this.sel = null;
			this.hint = '';
			void this.refresh();
		};
		right.createSpan({ text: this.baseToday, cls: 'ctrl-mono ctrl-small ctrl-muted' });
		const re = right.createEl('button', { text: '↻', cls: 'ctrl-btn' });
		re.onclick = () => void this.refresh();
	}

	// ── status line ────────────────────────────────────────
	private renderStatusLine(root: HTMLElement) {
		const line = root.createDiv({ cls: 'ctrl-statusline' });
		line.createSpan({ text: `status · ${this.sel ?? '—'}`, cls: 'ctrl-mono ctrl-small ctrl-muted' });
		const input = line.createEl('input', { type: 'text', placeholder: '[ID] [kw:] ein satz – enter setzt' });
		input.value = this.draft;
		const hint = line.createSpan({ cls: 'ctrl-mono ctrl-small ctrl-muted ctrl-hint' });
		const showHint = () => {
			const cmd = parseStatusInput(input.value, this.visibleTopics().map((t) => t.id));
			if (this.hint && !input.value) hint.setText(this.hint);
			else if (cmd?.kw || cmd?.id) hint.setText(`→ ${cmd.id ?? this.sel ?? '?'} ${cmd.kw ?? ''}`);
			else hint.setText(STATUS_KWS.join(' · '));
			hint.toggleClass('ctrl-energy', this.hint.startsWith('write') && !input.value);
		};
		showHint();
		input.oninput = () => {
			this.draft = input.value;
			showHint();
		};
		input.onkeydown = (ev) => {
			if (ev.key === 'Escape') {
				input.value = this.draft = '';
				showHint();
				ev.stopPropagation();
			}
			if (ev.key !== 'Enter' || !this.data) return;
			const data = this.data;
			const value = input.value;
			this.hint = '';
			void this.write(async () => {
				const id = await this.service.applyStatus(data, value, this.sel);
				this.draft = '';
				this.sel = id;
			});
		};
	}

	// ── radial net (Stufe 0) ───────────────────────────────
	private renderNet(card: HTMLElement, topics: Topic[]) {
		// geometry and encoding follow the design reference (Board Phase 5) 1:1
		const s = svg('svg', { viewBox: '0 0 860 780', class: 'ctrl-net' }, card);
		const defs = svg('defs', {}, s);
		const pat = svg('pattern', { id: 'ctrl-grain', width: 4, height: 4, patternUnits: 'userSpaceOnUse' }, defs);
		svg('circle', { cx: 2, cy: 2, r: 0.6, class: 'ctrl-grain-dot' }, pat);
		const n = topics.length;
		if (!n) {
			const t = svg('text', { x: C.x, y: C.y, class: 'ctrl-center', 'text-anchor': 'middle' }, s);
			t.textContent = 'Keine Themen im Board-Ordner';
			return;
		}
		const step = 360 / n;
		const gap = n > 8 ? 5 : 8;
		const sigOf = (id: string) => this.sig.get(id) as Signals;
		const maxE = Math.max(1, ...topics.map((t) => sigOf(t.id).energy));
		const rOf = (e: number) => R0 + (e / maxE) * (RMAX - R0);
		const energyByRank = [...topics].map((t) => sigOf(t.id).energy).sort((a, b) => b - a);
		const pos = new Map(topics.map((t, i) => [t.id, i * step]));
		const neighbours = (id: string) => {
			const t = topics.find((x) => x.id === id);
			return new Set([id, ...(t?.needs ?? []), ...(t?.blockedBy ?? []), ...topics.filter((x) => x.needs.includes(id) || x.blockedBy.includes(id)).map((x) => x.id)]);
		};

		const exploded = this.stage === 1 ? this.pin : null;
		if (exploded) s.addClass('is-exploded');
		const camG = svg('g', { class: 'ctrl-cam' }, s);
		const depG = svg('g', {}, camG);
		const bodyG = svg('g', { class: 'ctrl-body' }, camG);
		const labelG = svg('g', {}, camG);
		const hitG = svg('g', {}, camG);
		let hovered: string | null = null;
		s.addEventListener('wheel', (e) => this.onWheel(e, () => hovered), { passive: false });
		const groups = new Map<string, SVGElement[]>();
		const add = (id: string, e: SVGElement) => {
			const l = groups.get(id) ?? [];
			l.push(e);
			groups.set(id, l);
			return e;
		};

		topics.forEach((t, i) => {
			const k = sigOf(t.id);
			const ang = i * step;
			const a0 = ang - step / 2 + gap / 2;
			const a1 = ang + step / 2 - gap / 2;
			const rE = rOf(k.energy);
			const ex = exploded === t.id;
			const push = ex ? 16 : 0;
			const dim = exploded && !ex ? ' is-dim' : '';
			const g = add(t.id, svg('g', { class: 'ctrl-sector' + (k.stale ? ' is-stale' : '') + (this.sel === t.id && !exploded ? ' is-selected' : '') + dim }, bodyG));
			const outline = k.blocked ? 'is-blocked' : k.stale ? 'is-stale' : '';
			if (!ex) svg('path', { d: sectorPath(R0, rE, a0, a1), class: 'ctrl-sector-fill ctrl-outline ' + outline }, g);
			else svg('path', { d: sectorPath(R0, R0 + 10, a0, a1), class: 'ctrl-sector-fill ctrl-outline ' + outline }, g);
			let maxSteps = 0;
			// slop grain sits directly on the fill, below progress, separators, dots and step rows
			if (k.slop && !ex) svg('path', { d: sectorPath(R0, rE, a0, a1), fill: 'url(#ctrl-grain)', class: 'ctrl-grain' }, g);

			// slices = goals: width = 8 % minimum + rest proportional to goal energy
			const goals = t.goals.filter((x) => x.steps.length || !x.implicit);
			const ge = goals.map((go) => k.events.filter((e) => e.goal === go.id).reduce((a, e) => a + e.conf, 0));
			const esum = ge.reduce((a, b) => a + b, 0);
			const weight = (j: number) => (esum > 0 ? (ge[j] ?? 0) / esum : 1 / goals.length);
			const span = a1 - a0;
			const minW = goals.length ? span * 0.08 : 0;
			const free = span - minW * goals.length;
			let ga = a0;
			const bounds: number[] = [];
			goals.forEach((go, j) => {
				const gw = minW + free * weight(j);
				const done = go.steps.filter((x) => x.done).length;
				const pr = go.steps.length ? done / go.steps.length : 0;
				if (ex) {
					// explosion: slices pushed outwards, goal number, steps as a row outside the slice
					const g0 = ga + 1.2;
					const g1 = ga + gw - 1.2;
					svg('path', { d: sectorPath(R0 + push, rE + push, g0, g1), class: 'ctrl-sector-fill ctrl-slice-outline' + (k.blocked ? ' is-blocked' : '') }, g);
					if (k.slop) svg('path', { d: sectorPath(R0 + push, rE + push, g0, g1), fill: 'url(#ctrl-grain)', class: 'ctrl-grain' }, g);
					if (pr > 0 && rE > R0 + 1) svg('path', { d: sectorPath(R0 + push, R0 + push + (rE - R0) * pr, g0, g1), class: 'ctrl-progress' }, g);
					if (gw >= 5 && rE - R0 > 22) {
						const [nx, ny] = pol(R0 + push + (rE - R0) * 0.5, (g0 + g1) / 2);
						const nt = svg('text', { x: nx, y: ny + 2, class: 'ctrl-goal-nr', 'text-anchor': 'middle' }, g);
						nt.textContent = go.implicit ? '·' : (go.id.split('.').pop() ?? '');
					}
					go.steps.slice(0, 10).forEach((st, q) => {
						const [x, y] = pol(rE + push + 7 + q * 6, (g0 + g1) / 2);
						const c = svg('circle', { cx: x, cy: y, r: 1.7, class: 'ctrl-dot ctrl-dot-ex' + (st.done ? ' is-done' : '') }, g);
						const tt = svg('title', {}, c);
						tt.textContent = `${go.id} · ${st.text}${st.done ? ' ✓' : ''}`;
					});
					maxSteps = Math.max(maxSteps, Math.min(10, go.steps.length));
					ga += gw;
					bounds.push(ga);
					return;
				}
				if (pr > 0 && rE > R0 + 1) svg('path', { d: sectorPath(R0, R0 + (rE - R0) * pr, ga + 0.6, ga + gw - 0.6), class: 'ctrl-progress' }, g);
				// step dots in the core on hover / selection (● done, ○ open)
				// dots: evenly spaced lanes (not energy width) and pushed outwards until lanes are ≥ 8 px apart
				const dots = svg('g', { class: 'ctrl-dots' }, g);
				const lane = span / goals.length;
				const laneAng = a0 + (j + 0.5) * lane;
				const rStart = Math.max(R0 + 7, 8 / ((lane * Math.PI) / 180));
				go.steps.slice(0, 9).forEach((st, q) => {
					const [x, y] = pol(rStart + q * 8, laneAng);
					svg('circle', { cx: x, cy: y, r: 2.4, class: 'ctrl-dot' + (st.done ? ' is-done' : '') }, dots);
				});
				ga += gw;
				bounds.push(ga);
			});
			if (!ex) for (const b of bounds.slice(0, -1)) {
				const [x1, y1] = pol(R0, b);
				const [x2, y2] = pol(Math.max(rE, R0 + 2), b);
				svg('line', { x1, y1, x2, y2, class: 'ctrl-slice-sep' }, g);
			}
			// layering: fill + grain (back) → progress, separators (middle) → step dots (top)
			g.querySelectorAll('.ctrl-dots').forEach((d) => g.appendChild(d));

			// Soll-Marke + Δ (only when flagged, as in the design)
			if (k.misallocFlag) {
				const rS = rOf(energyByRank[t.prio - 1] ?? 0);
				svg('path', { d: arcPath(rS + push, a0, a1), class: 'ctrl-soll' }, g);
				const [lx, ly] = pol(Math.max(rS, rE) + push + 12, ang + (ex ? 4 : 7));
				const tx = svg('text', { x: lx, y: ly + 3, class: 'ctrl-delta', 'text-anchor': 'middle' }, g);
				tx.textContent = (k.misalloc > 0 ? '▲ +' : '▼ ') + String(k.misalloc);
			}
			// direction
			const rowEnd = rE + push + 7 + maxSteps * 6;
			const [tx, ty] = pol(ex ? rE + push + 10 : rE + (k.misallocFlag ? 22 : 6), ex ? a1 + 3 : ang);
			if (Math.abs(k.trend) < 0.12) svg('path', { d: `M ${tx} ${ty} m -3 0 l 6 0`, class: 'ctrl-trend is-flat' }, g);
			else svg('path', { d: arrow(tx, ty, ang - 90 + (k.trend > 0 ? 0 : 180), 6 + 12 * Math.abs(k.trend)), class: 'ctrl-trend' }, g);

			// radial label, mirrored on the left half
			const flip = ang > 180 && ang < 360;
			// label starts beyond arrow and Δ so a radial arrow never runs through the text
			const arrowEnd = rE + (k.misallocFlag ? 22 : 6) + 6 + 12 * Math.abs(k.trend) + 6;
			const rLabel = ex ? Math.max(RMAX + 30, rowEnd + 14) : Math.max(RMAX + 14, arrowEnd);
			const [lx, ly] = pol(rLabel, ang);
			// leader: hairline from the sector (behind arrow / step row) to the label
			const r1 = ex ? rowEnd + 2 : Math.max(rE + 3, arrowEnd - 4);
			if (rLabel - 4 - r1 > 4) {
				const [x1, y1] = pol(r1, ang);
				const [x2, y2] = pol(rLabel - 4, ang);
				add(t.id, svg('line', { x1, y1, x2, y2, class: 'ctrl-leader' + dim + (k.stale ? ' is-stale' : '') }, labelG));
			}
			const label = add(
				t.id,
				svg('text', { x: lx, y: ly + 3, class: 'ctrl-label' + (k.stale ? ' is-stale' : '') + dim, 'text-anchor': flip ? 'end' : 'start', transform: `rotate(${flip ? ang + 90 : ang - 90} ${lx} ${ly})` }, labelG),
			);
			const kw = t.status.kw !== 'läuft' ? ` · ${t.status.kw}` : '';
			label.textContent = ex ? `${t.id}  ${t.name}` : `${t.id}  ${short(t.name, 26)}${kw}`;

			const hit = svg('path', { d: sectorPath(R0, RMAX + 130, a0, a1), class: 'ctrl-hit' }, hitG);
			hit.onclick = () => {
				if (this.stage === 1 && this.pin !== t.id) {
					this.pin = t.id;
					this.sel = t.id;
					this.draw();
				} else if (this.stage === 1) this.deeper(t.id);
				else {
					this.focus = t.id;
					this.sel = t.id;
					this.draw();
				}
			};
			hit.ondblclick = () => this.openNote(t.path);
			hit.onmouseenter = () => {
				hovered = t.id;
				if (exploded) return;
				const rel = neighbours(t.id);
				s.addClass('has-hover');
				g.addClass('is-hover');
				for (const [id, els] of groups) for (const e of els) e.toggleClass('is-related', rel.has(id));
				depG.querySelectorAll('[data-a]').forEach((d) => {
					const on = d.getAttribute('data-a') === t.id || d.getAttribute('data-b') === t.id;
					d.toggleClass('is-related', on);
				});
			};
			hit.onmouseleave = () => {
				hovered = null;
				s.removeClass('has-hover');
				g.removeClass('is-hover');
			};
		});

		// dependencies: hairline through the core; full band with arrow on hover
		for (const t of topics) {
			for (const from of new Set([...t.needs, ...t.blockedBy])) {
				const a = pos.get(from);
				const b = pos.get(t.id);
				if (a === undefined || b === undefined) continue;
				const supplier = topics.find((x) => x.id === from);
				const open = !supplier || supplier.status.kw !== 'fertig';
				const blk = t.blockedBy.includes(from) && open;
				const rr = R0 - 2;
				const [ax, ay] = pol(rr, a);
				const [bx, by] = pol(rr, b);
				const cls = (blk ? ' is-blocked' : '') + (open ? '' : ' is-closed');
				const line = svg('path', { d: `M ${ax} ${ay} Q ${C.x} ${C.y} ${bx} ${by}`, class: 'ctrl-dep' + cls, 'data-a': from, 'data-b': t.id }, depG);
				line.onclick = () => {
					this.sel = from;
					this.draw();
				};
				const w = 3;
				const [a0x, a0y] = pol(rr, a - w);
				const [a1x, a1y] = pol(rr, a + w);
				const [b0x, b0y] = pol(rr, b - w);
				const [b1x, b1y] = pol(rr, b + w);
				const band = `M ${a0x} ${a0y} A ${rr} ${rr} 0 0 1 ${a1x} ${a1y} Q ${C.x} ${C.y} ${b0x} ${b0y} A ${rr} ${rr} 0 0 1 ${b1x} ${b1y} Q ${C.x} ${C.y} ${a0x} ${a0y} Z`;
				svg('path', { d: band, class: 'ctrl-dep-band' + cls, 'data-a': from, 'data-b': t.id }, depG);
				const mx = ((ax + bx) / 2) * 0.5 + C.x * 0.5;
				const my = ((ay + by) / 2) * 0.5 + C.y * 0.5;
				svg('path', { d: arrow(mx, my, (Math.atan2(by - my, bx - mx) * 180) / Math.PI, 8), class: 'ctrl-dep-arrow' + cls, 'data-a': from, 'data-b': t.id }, depG);
			}
		}

		// camera: deterministic move towards the pinned sector (S = 1.9), animated from the last position
		let cam = 'translate(0px, 0px) scale(1)';
		const pa = exploded ? pos.get(exploded) : undefined;
		if (pa !== undefined) {
			const S = 1.9;
			const [px, py] = pol((R0 + RMAX) / 2 + 85, pa);
			cam = `translate(${(C.x - S * px).toFixed(1)}px, ${(C.y - S * py).toFixed(1)}px) scale(${S})`;
		}
		camG.style.transform = this.cam;
		if (cam !== this.cam) window.requestAnimationFrame(() => window.requestAnimationFrame(() => (camG.style.transform = cam)));
		this.cam = cam;

		const evs = this.windowEvents();
		if (exploded) {
			this.legend(card, ['explosion · slices = ziele (füllung = fortschritt) · ● erledigt ○ offen außen am slice', 'anderer sektor = umpinnen · gepinnter sektor / rad hinein = graph', 'rad heraus / esc = übersicht'], 'rad = stufe · klick = pin · doppelklick = notiz');
			return;
		}
		const c1 = svg('text', { x: C.x, y: C.y - 2, class: 'ctrl-center', 'text-anchor': 'middle' }, s);
		c1.textContent = `${evs.filter((e) => e.topic).length} ereignisse · ${this.win} d`;
		const c2 = svg('text', { x: C.x, y: C.y + 12, class: 'ctrl-center ctrl-center-2', 'text-anchor': 'middle' }, s);
		c2.textContent = `${evs.filter((e) => !e.topic).length} nicht zugeordnet`;

		this.legend(
			card,
			['radius = energie (stunden) · slice = ziel (breite = anteil, füllung = fortschritt)', '▮ soll-marke + Δ = fehlallokation · pfeil = richtung · körnung = slop', 'gepunktet + blass = stale · farbe = nur blockiert'],
			'klick = graph · rad hinein = explosion · doppelklick = notiz',
		);
	}

	private legend(card: HTMLElement, lines: string[], gesture: string) {
		const foot = card.createDiv({ cls: 'ctrl-legend ctrl-mono' });
		const l = foot.createDiv();
		for (const x of lines) l.createDiv({ text: x });
		foot.createDiv({ text: gesture, cls: 'ctrl-gesture' });
	}

	// ── Stufe 2 · Graph ────────────────────────────────────
	private renderGraph(card: HTMLElement, t: Topic, topics: Topic[]) {
		const k = this.sig.get(t.id) as Signals;
		const ref = this.today;
		const lanes = [...t.goals.filter((g) => g.steps.length || !g.implicit).sort((a, b) => Number(b.cd) - Number(a.cd))];
		const par = t.parallel.length ? [{ id: `${t.id}.p`, name: 'Parallel', implicit: true, cd: false, metric: '', needs: [] as string[], blockedBy: [] as string[], line: -1, lastLine: -1, steps: t.parallel }] : [];
		const rows = [...lanes, ...par];
		const rowH = 46;
		const L = 232;
		const W = 860;
		const T = 56;
		const xMin = L;
		const xMax = W - 60 - 90;
		const H = Math.max(T + rowH * (rows.length + 1) + 50, 360);
		const span = 355;
		const start = addDays(ref, -span);
		const X = (d: string) => xMin + (Math.min(span, Math.max(0, daysBetween(start, d))) / span) * (xMax - xMin);
		const xToday = X(ref);
		const xPlan = xToday + 14;
		const w28 = addDays(ref, -28);
		const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ctrl-net ctrl-graph' }, card);
		s.addEventListener('wheel', (e) => this.onWheel(e, () => null), { passive: false });
		const defs = svg('defs', {}, s);
		const pat = svg('pattern', { id: 'ctrl-grain-g', width: 4, height: 4, patternUnits: 'userSpaceOnUse' }, defs);
		svg('circle', { cx: 2, cy: 2, r: 0.6, class: 'ctrl-grain-dot' }, pat);
		const tx = (x: number, y: number, text: string, cls: string, anchor = 'start', parent: Element = s) => {
			const e = svg('text', { x, y, class: cls, 'text-anchor': anchor }, parent);
			e.textContent = text;
			return e;
		};
		// month grid
		const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
		const [sy, sm] = start.split('-').map(Number) as [number, number];
		for (let i = 1; i <= 12; i++) {
			const m = ((sm - 1 + i) % 12) + 1;
			const y = sy + Math.floor((sm - 1 + i) / 12);
			const d = `${y}-${String(m).padStart(2, '0')}-01`;
			if (daysBetween(d, ref) < 0) break;
			const x = X(d);
			svg('path', { d: `M ${x} ${T - 8} V ${H - 36}`, class: 'ctrl-grid' }, s);
			tx(x + 3, H - 24, MONTHS[m - 1] ?? '', 'ctrl-axis');
		}
		svg('path', { d: `M ${X(w28)} ${T - 8} H ${xToday} V ${H - 36} H ${X(w28)} Z`, class: 'ctrl-window' }, s);
		tx(X(w28) + 3, T - 12, '28 d', 'ctrl-axis ctrl-axis-s');
		svg('path', { d: `M ${xToday} ${T - 16} V ${H - 36}`, class: 'ctrl-today' }, s);
		tx(xToday, T - 20, 'heute', 'ctrl-axis ctrl-axis-2', 'middle');
		tx(xPlan + 2, T - 20, 'offen →', 'ctrl-axis ctrl-axis-s');

		// trunk
		const yT = T + rowH / 2;
		const evs = (this.data?.events ?? []).filter((e) => e.topic === t.id && daysBetween(e.at, ref) >= 0);
		const firstEv = evs.map((e) => e.at).sort()[0] ?? addDays(ref, -30);
		svg('path', { d: `M ${X(firstEv)} ${yT} H ${xToday}`, class: 'ctrl-trunk' + (k.blocked ? ' is-blocked' : '') }, s);
		tx(L - 10, yT - 2, t.id, 'ctrl-axis ctrl-axis-m', 'end');
		tx(L - 10, yT + 10, short(t.name, 30), 'ctrl-g-name ctrl-g-trunk', 'end');
		const flags = [k.blocked && 'blockiert', k.slop && 'slop', k.misallocFlag && (k.misalloc > 0 ? `▲ +${k.misalloc}` : `▼ ${k.misalloc}`), k.stale && 'stale'].filter(Boolean).join(' · ');
		if (flags) tx(xToday + 6, yT + 3, flags, 'ctrl-g-flags' + (k.blocked ? ' is-blocked' : ''));
		// topic events without goal → ticks on the trunk
		const seenT = new Set<number>();
		for (const e of evs.filter((x) => !x.goal)) {
			const b = Math.round(daysBetween(start, e.at) / 3);
			if (seenT.has(b)) continue;
			seenT.add(b);
			const x = X(e.at);
			svg('path', { d: `M ${x} ${yT - 9} V ${yT - 4}`, class: 'ctrl-tick' }, s);
		}

		rows.forEach((g, i) => {
			const y = T + rowH * (i + 1) + rowH / 2;
			const row = svg('g', { class: 'ctrl-row-g' }, s);
			const done = g.steps.filter((x) => x.done).sort((a, b) => (a.doneAt ?? '').localeCompare(b.doneAt ?? ''));
			const open = g.steps.filter((x) => !x.done);
			const gev = evs.filter((e) => e.goal === g.id);
			const dated = done.map((x) => x.doneAt).filter((d): d is string => !!d);
			const lastDone = dated[dated.length - 1];
			const stale = !lastDone || daysBetween(lastDone, ref) > this.staleDays;
			const cls = k.blocked ? ' is-blocked' : stale ? ' is-stale' : '';
			const t0 = [...gev.map((e) => e.at), ...dated].sort()[0] ?? addDays(ref, -30);
			const x0 = X(t0);
			const xLast = lastDone ? X(lastDone) : x0;
			svg('path', { d: `M ${x0} ${yT} C ${x0} ${yT + rowH / 2} ${x0 + 10} ${y - rowH / 2} ${x0 + 10} ${y}`, class: 'ctrl-branch-fork' + cls }, row);
			svg('path', { d: `M ${x0 + 10} ${y} H ${Math.max(xLast, x0 + 10)}`, class: 'ctrl-branch' + cls }, row);
			svg('path', { d: `M ${Math.max(xLast, x0 + 10)} ${y} H ${xToday}`, class: 'ctrl-branch' + cls + (stale ? ' is-decay' : '') }, row);
			if (!open.length && done.length && lastDone) svg('path', { d: `M ${xLast} ${y} C ${xLast + 10} ${y} ${xLast + 14} ${yT + rowH / 2} ${xLast + 16} ${yT}`, class: 'ctrl-branch-fork' + cls }, row);
			const seen = new Set<number>();
			for (const e of gev) {
				const b = Math.round(daysBetween(start, e.at) / 3);
				if (seen.has(b)) continue;
				seen.add(b);
				const x = X(e.at);
				svg('path', { d: `M ${x} ${y - 9} V ${y - 4}`, class: 'ctrl-tick' }, row);
			}
			const inWin = gev.filter((e) => daysBetween(e.at, ref) < 28).length;
			const doneWin = dated.filter((d) => daysBetween(d, ref) < 28).length;
			if (inWin >= 4 && doneWin === 0) svg('path', { d: `M ${X(w28)} ${y - 12} H ${xToday} V ${y + 12} H ${X(w28)} Z`, fill: 'url(#ctrl-grain-g)' }, row);
			const stepDot = (st: Step, x: number, isDone: boolean) => {
				const c = svg('circle', { cx: x, cy: y, r: 3.5, class: isDone ? 'ctrl-commit' : 'ctrl-open' + cls }, row);
				const tt = svg('title', {}, c);
				tt.textContent = `${st.text}${st.doneAt ? ' · ' + st.doneAt : ''}`;
				const hit = svg('circle', { cx: x, cy: y, r: 8, class: 'ctrl-hit' }, row);
				hit.appendChild(tt.cloneNode(true));
				hit.onclick = () => {
					this.selStep = { topic: t.id, id: st.id };
					this.sel = t.id;
					this.draw();
				};
				if (this.selStep?.id === st.id) c.addClass('is-sel');
			};
			for (const st of done) stepDot(st, st.doneAt ? X(st.doneAt) : xToday - 4, true);
			open.forEach((st, j) => stepDot(st, xPlan + 6 + j * 12, false));
			const nr = g.implicit ? (g.name === 'Parallel' ? 'p' : '·') : (g.id.split('.').pop() ?? '');
			tx(L - 10, y - 2, `${nr} · ${done.length}/${g.steps.length}${stale && lastDone ? ' · stale ' + daysBetween(lastDone, ref) + ' d' : ''}${g.cd ? ' · cd' : ''}`, 'ctrl-axis' + (stale ? ' ctrl-axis-m' : ' ctrl-axis-2'), 'end', row);
			tx(L - 10, y + 10, short(g.name, 30), 'ctrl-g-name' + (stale ? ' is-stale' : ''), 'end', row);
			const hitRow = svg('path', { d: `M 0 ${y - rowH / 2} H ${W} V ${y + rowH / 2} H 0 Z`, class: 'ctrl-row-hit' }, s);
			s.insertBefore(hitRow, s.firstChild?.nextSibling ?? null);
			hitRow.onmouseenter = () => {
				s.addClass('has-hover');
				row.addClass('is-related');
			};
			hitRow.onmouseleave = () => {
				s.removeClass('has-hover');
				row.removeClass('is-related');
			};
		});

		// goal-level dependencies: inside the topic as vertical connector, outside as port on the row
		const laneY = new Map(rows.map((g, i) => [g.id, T + rowH * (i + 1) + rowH / 2]));
		let vi = 0;
		rows.forEach((g) => {
			const yb = laneY.get(g.id) ?? 0;
			const edges = [...g.needs.map((id) => ({ id, blk: false })), ...g.blockedBy.map((id) => ({ id, blk: true }))];
			edges.forEach((d, j) => {
				const ya = laneY.get(d.id);
				const cls = d.blk ? ' is-blocked' : '';
				if (ya !== undefined) {
					const x = xToday - 24 - vi++ * 6;
					svg('path', { d: `M ${x} ${ya} V ${yb}`, class: 'ctrl-port' + cls }, s);
					svg('path', { d: arrow(x, yb + (yb > ya ? -8 : 8), yb > ya ? 90 : -90, 7), class: 'ctrl-port ctrl-port-arrow' + cls }, s);
				} else {
					const x = W - 56;
					const y = yb + j * 10;
					svg('path', { d: `M ${x} ${y} H ${x + 14}`, class: 'ctrl-port' + cls }, s);
					const lt = tx(x + 18, y + 3, `${d.blk ? 'blockiert' : 'braucht'} ${d.id}`, 'ctrl-port-label ctrl-link' + cls);
					lt.onclick = () => {
						const other = d.id.split('.')[0] ?? d.id;
						this.focus = other;
						this.sel = other;
						this.selStep = null;
						this.draw();
					};
				}
			});
			// incoming from other topics' goals
			for (const o of topics) {
				if (o.id === t.id) continue;
				for (const og of o.goals) {
					if (og.needs.includes(g.id) || og.blockedBy.includes(g.id)) {
						const blk = og.blockedBy.includes(g.id);
						const x = W - 56;
						const y = yb - 10;
						svg('path', { d: `M ${x} ${y} H ${x + 14}`, class: 'ctrl-port' + (blk ? ' is-blocked' : '') }, s);
						const lt = tx(x + 18, y + 3, `liefert an ${og.id}`, 'ctrl-port-label ctrl-link' + (blk ? ' is-blocked' : ''));
						lt.onclick = () => {
							this.focus = o.id;
							this.sel = o.id;
							this.draw();
						};
					}
				}
			}
		});

		// dependencies of the topic → ports on the right (click jumps to the other graph)
		const deps = [...new Set([...t.needs, ...t.blockedBy])].map((id) => ({ id, type: t.blockedBy.includes(id) ? 'blockiert' : 'braucht', out: false }));
		for (const o of topics) if (o.needs.includes(t.id) || o.blockedBy.includes(t.id)) deps.push({ id: o.id, type: 'liefert an', out: true });
		deps.forEach((d, i) => {
			const y = yT + i * 12;
			const x = W - 56;
			const blk = d.type === 'blockiert';
			svg('path', { d: `M ${x} ${y} H ${x + 14}`, class: 'ctrl-port' + (blk ? ' is-blocked' : '') }, s);
			const lt = tx(x + 18, y + 3, `${d.type} ${d.id}`, 'ctrl-port-label ctrl-link' + (blk ? ' is-blocked' : ''));
			lt.onclick = () => {
				this.focus = d.id;
				this.sel = d.id;
				this.draw();
			};
		});

		this.legend(
			card,
			['trunk = thema · branch = ziel (cd zuerst) · ● commit = erledigter schritt · ○ rechts = offen, in reihenfolge', 'tick oben = ereignis · körnung im 28-d-fenster = slop · gepunktet + blass nach letztem commit = stale', 'port rechts = abhängigkeit (energieton = blockiert), klick springt'],
			'klick ○/● = schritt wählen · rad heraus / esc = explosion',
		);
	}
	private windowEvents(): BoardEvent[] {
		const ref = this.today;
		return (this.data?.events ?? []).filter((e) => {
			const d = daysBetween(e.at, ref);
			return d >= 0 && d < this.win;
		});
	}

	// ── detail card ────────────────────────────────────────
	private renderDetail(card: HTMLElement, topics: Topic[]) {
		const t = this.topic(this.sel);
		if (!t) return this.renderOverview(card, topics);
		const sg = this.sig.get(t.id);
		if (!sg) return;
		const head = card.createDiv({ cls: 'ctrl-detail-head' });
		head.createSpan({ text: `${t.id} · thema`, cls: 'ctrl-mono ctrl-small ctrl-muted' });
		const flags = [sg.blocked ? 'blockiert' : '', sg.slop ? 'slop' : '', sg.stale ? 'stale' : '', sg.misallocFlag ? `Δ ${sg.misalloc > 0 ? '+' : ''}${sg.misalloc}` : '']
			.filter(Boolean)
			.join(' · ');
		head.createSpan({ text: flags, cls: 'ctrl-mono ctrl-small' + (sg.blocked ? ' ctrl-energy' : ' ctrl-muted') });
		const name = card.createEl('input', { type: 'text', cls: 'ctrl-name ctrl-name-input', attr: { 'aria-label': 'Name' } });
		name.value = t.name;
		name.disabled = this.demo;
		const commitName = () => {
			if (name.value.trim() && name.value.trim() !== t.name) void this.write(() => this.service.rename(t, name.value));
		};
		name.onkeydown = (e) => {
			if (e.key === 'Enter') name.blur();
			if (e.key === 'Escape') {
				name.value = t.name;
				name.blur();
				e.stopPropagation();
			}
		};
		name.onblur = commitName;

		const actions = card.createDiv({ cls: 'ctrl-actions' });
		const btn = (label: string, fn: () => void) => {
			const b = actions.createEl('button', { text: label, cls: 'ctrl-btn' });
			b.onclick = fn;
		};
		btn('▲ priorität', () => this.data && void this.write(() => this.service.movePrio(this.data as BoardData, t.id, -1)));
		btn('▼ priorität', () => this.data && void this.write(() => this.service.movePrio(this.data as BoardData, t.id, 1)));
		btn('+ ziel', () => {
			this.adding = 'goal';
			this.draw();
		});
		btn('+ schritt', () => {
			this.adding = t.goals[0]?.id ?? `${t.id}.0`;
			this.draw();
		});
		btn('↗ notiz', () => this.openNote(t.path));
		if (this.adding === 'goal') this.addInput(card, 'neues ziel – enter legt an', (v) => this.service.addGoal(t, v));

		// gewählter Schritt
		const chosen = this.selStep?.topic === t.id ? [...t.goals.flatMap((g) => g.steps), ...t.parallel].find((x) => x.id === this.selStep?.id) : undefined;
		if (chosen) {
			const sb = card.createDiv({ cls: 'ctrl-statusbox ctrl-stepbox' });
			const hd = sb.createDiv({ cls: 'ctrl-detail-head' });
			hd.createSpan({ text: `${chosen.goalId || t.id} · schritt`, cls: 'ctrl-mono ctrl-tiny ctrl-muted' });
			const x = hd.createSpan({ text: '×', cls: 'ctrl-link ctrl-muted' });
			x.onclick = () => {
				this.selStep = null;
				this.draw();
			};
			sb.createDiv({ text: chosen.text });
			sb.createDiv({ text: chosen.done ? `erledigt · ${chosen.doneAt ?? 'ohne datum'}` : 'offen', cls: 'ctrl-mono ctrl-small ctrl-muted' });
			const sa = sb.createDiv({ cls: 'ctrl-actions' });
			const tb = sa.createEl('button', { text: chosen.done ? '☑ zurücknehmen' : '☐ erledigt setzen', cls: 'ctrl-btn' });
			tb.onclick = () => void this.write(() => this.service.toggle(t.path, chosen, !chosen.done));
		}

		const box = card.createDiv({ cls: 'ctrl-statusbox' });
		box.createDiv({ text: 'STATUS · MANUELL', cls: 'ctrl-mono ctrl-tiny ctrl-muted' });
		box.createDiv({ text: t.status.text || '—' });
		box.createDiv({ text: `${t.status.kw} · ${t.status.at ?? '—'}`, cls: 'ctrl-mono ctrl-small ctrl-muted' });

		const rows = card.createDiv({ cls: 'ctrl-rows' });
		const row = (k: string, v: string) => {
			const r = rows.createDiv({ cls: 'ctrl-row' });
			r.createSpan({ text: k });
			r.createSpan({ text: v, cls: 'ctrl-mono' });
		};
		row('Energie', `${sg.energy} h · ${this.win} d`);
		row('Richtung', `${sg.trend > 0.12 ? '▲' : sg.trend < -0.12 ? '▼' : '–'} ${sg.prevEnergy} → ${sg.energy}`);
		row('Fortschritt', `${sg.done}/${sg.total} · ${Math.round(sg.progress * 100)} %`);
		row('Letzter Fortschritt', sg.staleDays === null ? 'nie datiert' : `vor ${sg.staleDays} d`);
		row('Priorität · Energie-Rang', `${t.prio} · ${sg.energyRank}`);
		row('Geprüft', t.reviewed ? `vor ${daysBetween(t.reviewed, this.today)} d` : '—');
		row('Rückführung', t.returnCondition || 'unbekannt');

		const goals = [...t.goals].sort((a, b) => Number(b.cd) - Number(a.cd));
		if (!goals.length && this.adding && this.adding !== 'goal') {
			this.section(card, 'Schritte');
			this.addInput(card, 'neuer schritt – enter legt an', (v) => this.service.addStep(t, `${t.id}.0`, v));
		}
		for (const g of goals) {
			if (g.implicit && !g.steps.length && this.adding !== g.id) continue;
			const sec = card.createDiv({ cls: 'ctrl-section-row' });
			sec.createSpan({ text: (g.implicit ? 'Schritte' : `${g.id} ${g.name}${g.cd ? '  · cd' : ''}`).toUpperCase(), cls: 'ctrl-section ctrl-mono ctrl-tiny ctrl-muted' });
			const plus = sec.createSpan({ text: '+', cls: 'ctrl-link ctrl-mono ctrl-muted', attr: { 'aria-label': 'schritt anlegen' } });
			plus.onclick = () => {
				this.adding = g.id;
				this.draw();
			};
			if (g.metric) card.createDiv({ text: g.metric, cls: 'ctrl-metric ctrl-small' });
			const gd = [...g.needs.map((x) => `braucht ${x}`), ...g.blockedBy.map((x) => `blockiert durch ${x}`)];
			if (gd.length) card.createDiv({ text: gd.join(' · '), cls: 'ctrl-metric ctrl-small' + (g.blockedBy.length ? ' ctrl-energy' : '') });
			const list = card.createDiv({ cls: 'ctrl-list' });
			if (this.adding === g.id) this.addInput(card, `neuer schritt in ${g.implicit ? 'Schritte' : g.id} – enter legt an`, (v) => this.service.addStep(t, g.id, v));
			for (const st of g.steps) this.stepItem(list, t.path, st);
		}
		if (t.parallel.length) {
			this.section(card, 'Parallel');
			const list = card.createDiv({ cls: 'ctrl-list' });
			for (const st of t.parallel) this.stepItem(list, t.path, st);
		}
		const qs = t.questions.filter((q) => !q.done);
		if (qs.length) {
			this.section(card, 'Zu klären');
			const list = card.createDiv({ cls: 'ctrl-list' });
			for (const q of this.sortQuestions(qs)) this.questionItem(list, t, q, false);
		}

		const ch = chain(topics, t.id);
		if (ch.suppliers.length || ch.consumers.length) {
			this.section(card, 'Kette');
			const k = card.createDiv({ cls: 'ctrl-chain ctrl-mono' });
			const link = (id: string) => {
				const sp = k.createSpan({ text: id, cls: 'ctrl-link' + (t.blockedBy.includes(id) ? ' ctrl-energy' : '') });
				sp.onclick = () => {
					this.sel = id;
					this.draw();
				};
				k.createSpan({ text: ' ' });
			};
			ch.suppliers.forEach(link);
			k.createSpan({ text: '← ● → ', cls: 'ctrl-muted' });
			ch.consumers.forEach(link);
		}

		this.section(card, `Ereignisse · ${sg.events.length}`);
		const ev = card.createDiv({ cls: 'ctrl-list' });
		for (const e of sg.events.slice(0, 6)) {
			const r = ev.createDiv({ cls: 'ctrl-item ctrl-link' });
			r.createSpan({ text: `${mmdd(e.at)} · ${short(e.title, 32)}` });
			r.createSpan({ text: e.hours ? `${e.conf} h` : e.conf >= 0.5 ? 'thema' : 'link', cls: 'ctrl-mono ctrl-small ctrl-muted' });
			r.onclick = () => this.openNote(e.path);
		}
	}

	private renderOverview(card: HTMLElement, topics: Topic[]) {
		card.createDiv({ text: 'ÜBERSICHT', cls: 'ctrl-mono ctrl-tiny ctrl-muted' });
		const sigs = topics.map((t) => this.sig.get(t.id)).filter((x): x is Signals => !!x);
		const counts = card.createDiv({ cls: 'ctrl-counts' });
		const cnt = (n: number, label: string, hot = false) => {
			const c = counts.createDiv({ cls: 'ctrl-count' });
			c.createDiv({ text: String(n), cls: 'ctrl-mono ctrl-big' + (hot && n ? ' ctrl-energy' : '') });
			c.createDiv({ text: label, cls: 'ctrl-mono ctrl-tiny ctrl-muted' });
		};
		cnt(sigs.filter((s) => s.misallocFlag).length, 'Δ prio');
		cnt(sigs.filter((s) => s.slop).length, 'slop');
		cnt(sigs.filter((s) => s.stale).length, 'stale');
		cnt(sigs.filter((s) => s.blocked).length, 'blockiert', true);

		// CD-Ziele (Contribution Dialog) – Vorrang vor allem anderen
		const cd = topics.flatMap((t) => t.goals.filter((g) => g.cd).map((g) => ({ t, g })));
		if (cd.length) {
			const ref = this.today;
			this.section(card, `CD-Ziele · ${cd.length}`);
			const cl = card.createDiv({ cls: 'ctrl-list' });
			for (const { t, g } of cd) {
				const done = g.steps.filter((x) => x.done).length;
				const last = g.steps.map((x) => x.doneAt).filter((d): d is string => !!d).sort().pop();
				const ev = (this.sig.get(t.id)?.events ?? []).filter((e) => e.goal === g.id).length;
				const still = !last || daysBetween(last, ref) > this.staleDays;
				const r = cl.createDiv({ cls: 'ctrl-item ctrl-cd' + (still ? ' is-still' : ''), attr: { title: g.metric } });
				const box = r.createSpan({ cls: 'ctrl-cd-bar' });
				box.createSpan({ cls: 'ctrl-cd-fill', attr: { style: `width:${g.steps.length ? Math.round((done / g.steps.length) * 100) : 0}%` } });
				const tg = r.createSpan({ text: g.id, cls: 'ctrl-mono ctrl-small ctrl-link' });
				tg.onclick = () => {
					this.sel = t.id;
					this.draw();
				};
				r.createSpan({ text: g.name, cls: 'ctrl-grow' });
				r.createSpan({ text: `${done}/${g.steps.length}${ev ? ` · ${ev} ev` : ''}${still ? ' · still' : ''}`, cls: 'ctrl-mono ctrl-small ctrl-muted' });
			}
		}

		// Fokus
		const main = this.data?.main;
		const focus: { path: string; tag: string; step: Step }[] = [];
		for (const t of topics) for (const st of [...allSteps(t), ...t.parallel]) if (st.fokus && !st.done) focus.push({ path: t.path, tag: t.id, step: st });
		if (main) for (const st of main.focus) if (!st.done) focus.push({ path: main.path, tag: 'main', step: st });
		this.section(card, `Fokus · ${focus.length}`);
		const fl = card.createDiv({ cls: 'ctrl-list' });
		for (const f of focus) this.stepItem(fl, f.path, f.step, f.tag);
		if (!focus.length) fl.createDiv({ text: '#fokus an Schritten setzen', cls: 'ctrl-muted ctrl-small' });

		// Zu klären
		const qs: { t: Topic | null; q: Question; path: string }[] = [];
		for (const t of topics) for (const q of t.questions) if (!q.done) qs.push({ t, q, path: t.path });
		if (main) for (const q of main.questions) if (!q.done) qs.push({ t: null, q, path: main.path });
		const order: Question['kind'][] = ['entscheidung', 'frage', 'risiko'];
		qs.sort((a, b) => order.indexOf(a.q.kind) - order.indexOf(b.q.kind) || (a.t?.prio ?? 0) - (b.t?.prio ?? 0));
		this.section(card, `Zu klären · ${qs.length}`);
		const ql = card.createDiv({ cls: 'ctrl-list' });
		for (const x of qs) this.questionItem(ql, x.t, x.q, true, x.path);

		const evs = this.windowEvents();
		const un = evs.filter((e) => !e.topic).length;
		const rows = card.createDiv({ cls: 'ctrl-rows' });
		const row = (k: string, v: string) => {
			const r = rows.createDiv({ cls: 'ctrl-row' });
			r.createSpan({ text: k });
			r.createSpan({ text: v, cls: 'ctrl-mono' });
		};
		row('Ereignisse', `${evs.length - un} · ${this.win} d`);
		row('Nicht zugeordnet', `${un} · ${evs.length ? Math.round((un / evs.length) * 100) : 0} %`);
		row('Erledigt im Fenster', String(sigs.reduce((a, s) => a + s.doneInWindow, 0)));
	}

	private addInput(card: HTMLElement, placeholder: string, fn: (v: string) => Promise<unknown>) {
		const inp = card.createEl('input', { type: 'text', cls: 'ctrl-add', placeholder });
		window.setTimeout(() => inp.focus(), 0);
		inp.onkeydown = (e) => {
			if (e.key === 'Escape') {
				this.adding = null;
				e.stopPropagation();
				this.draw();
			}
			if (e.key !== 'Enter' || !inp.value.trim()) return;
			const v = inp.value;
			this.adding = null;
			void this.write(() => fn(v));
		};
	}

	private sortQuestions(qs: Question[]) {
		const order: Question['kind'][] = ['entscheidung', 'frage', 'risiko'];
		return [...qs].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
	}

	private section(card: HTMLElement, title: string) {
		card.createDiv({ text: title.toUpperCase(), cls: 'ctrl-section ctrl-mono ctrl-tiny ctrl-muted' });
	}

	private stepItem(list: HTMLElement, path: string, st: Step, tag?: string) {
		const r = list.createDiv({ cls: 'ctrl-item' + (st.level ? ' is-sub' : '') });
		const box = r.createSpan({ text: st.done ? '☑' : '☐', cls: 'ctrl-box' });
		box.onclick = () => void this.write(() => this.service.toggle(path, st, !st.done));
		if (tag) {
			const tg = r.createSpan({ text: tag, cls: 'ctrl-mono ctrl-small ctrl-link' });
			tg.onclick = () => {
				this.sel = tag === 'main' ? null : tag;
				this.draw();
			};
		}
		const txt = r.createSpan({ text: st.text, cls: 'ctrl-grow ctrl-link' + (st.done ? ' is-done' : '') + (this.selStep?.id === st.id ? ' ctrl-energy' : '') });
		txt.onclick = () => {
			const topicId = st.goalId.split('.')[0] || st.id.split('.')[0] || '';
			this.selStep = { topic: topicId, id: st.id };
			if (topicId && this.topic(topicId)) this.sel = topicId;
			this.draw();
		};
		r.createSpan({ text: [st.fokus ? 'fokus' : '', st.doneAt ? mmdd(st.doneAt) : ''].filter(Boolean).join(' · '), cls: 'ctrl-mono ctrl-small ctrl-muted' });
	}

	private questionItem(list: HTMLElement, t: Topic | null, q: Question, withTag: boolean, path = t?.path ?? '') {
		const r = list.createDiv({ cls: 'ctrl-item' });
		const box = r.createSpan({ text: KIND_MARK[q.kind], cls: 'ctrl-box ctrl-mono ctrl-kind-' + q.kind, attr: { 'aria-label': `${q.kind} erledigen` } });
		box.onclick = () => void this.write(() => this.service.toggle(path, q, true));
		if (withTag) {
			const tg = r.createSpan({ text: t?.id ?? 'main', cls: 'ctrl-mono ctrl-small ctrl-link' });
			tg.onclick = () => {
				this.sel = t?.id ?? null;
				this.draw();
			};
		}
		r.createSpan({ text: q.text.replace(/@\S+/g, '').trim(), cls: 'ctrl-grow' });
		if (q.persons.length) r.createSpan({ text: q.persons.map((p) => '@' + p).join(' '), cls: 'ctrl-mono ctrl-small ctrl-muted' });
	}

	// ── unassigned ─────────────────────────────────────────
	private renderUnassigned(root: HTMLElement) {
		const evs = this.windowEvents()
			.filter((e) => !e.topic)
			.sort((a, b) => b.at.localeCompare(a.at));
		const box = root.createDiv({ cls: 'ctrl-unassigned' });
		const left = box.createDiv();
		left.createDiv({ text: 'NICHT ZUGEORDNET', cls: 'ctrl-mono ctrl-tiny ctrl-muted' });
		left.createDiv({ text: String(evs.length), cls: 'ctrl-mono ctrl-big ctrl-secondary' });
		left.createDiv({ text: `notizen · ${this.win} d`, cls: 'ctrl-mono ctrl-small ctrl-muted' });
		const t = this.topic(this.sel);
		left.createDiv({ text: t ? `→ ${t.id} setzt thema: ${t.id}` : 'thema wählen, dann → zuordnen', cls: 'ctrl-mono ctrl-small ctrl-muted' });
		const grid = box.createDiv({ cls: 'ctrl-ua-grid' });
		for (const e of evs.slice(0, 60)) {
			const it = grid.createDiv({ cls: 'ctrl-ua-item' });
			const lbl = it.createSpan({ text: `${mmdd(e.at)} · ${short(e.title, 28)}`, cls: 'ctrl-link ctrl-grow', attr: { title: e.path } });
			lbl.onclick = () => this.openNote(e.path);
			const b = it.createEl('button', { text: t ? `→ ${t.id}` : '→', cls: 'ctrl-btn ctrl-btn-xs' });
			b.disabled = !t;
			b.onclick = () => {
				if (!t) return;
				void this.write(() => this.service.assign(e.path, t)).then(() => new Notice(`${short(e.title, 30)} → ${t.id}`));
			};
		}
		if (evs.length > 60) grid.createDiv({ text: `+ ${evs.length - 60} weitere`, cls: 'ctrl-mono ctrl-small ctrl-muted' });
	}
}
