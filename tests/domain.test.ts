import { describe, expect, it } from 'vitest';
import { parseBody, toggleTaskLine } from '../src/domain/parse';
import { computeSignals } from '../src/domain/signals';
import { parseStatusInput } from '../src/domain/status-input';
import type { BoardEvent, Topic } from '../src/domain/model';

const NOTE = `---
type: thema
id: S2
---
# S2

## Ziele
- [x] AL-Bild getragen ✅ 2026-09-29
- [ ] Konzept fertigstellen #fokus
  - [ ] Teilschritt
### S2.1 Regionen anbinden #cd
Messung: 2 Regionen produktiv
- [ ] EMEA

## Offene Fragen
- [?] Wahrnehmung?
- [!] Entscheidung Budget @TobiK @Chris
- [r] Risiko Kapa
- [x] alte Frage ✅ 2026-10-01

## Parallel
- [ ] Anfrage LA
`;

describe('parseBody', () => {
	const p = parseBody(NOTE, 'S2');
	it('builds implicit and explicit goals', () => {
		expect(p.goals.map((g) => g.id)).toEqual(['S2.0', 'S2.1']);
		expect(p.goals[0]?.steps).toHaveLength(3);
		expect(p.goals[0]?.steps[0]).toMatchObject({ done: true, doneAt: '2026-09-29', text: 'AL-Bild getragen' });
		expect(p.goals[0]?.steps[1]).toMatchObject({ fokus: true, text: 'Konzept fertigstellen' });
		expect(p.goals[0]?.steps[2]?.level).toBe(1);
	});
	it('reads #cd and the metric line', () => {
		expect(p.goals[1]).toMatchObject({ name: 'Regionen anbinden', cd: true, metric: '2 Regionen produktiv' });
		expect(p.goals[0]?.cd).toBe(false);
	});
	it('parses questions with kinds and persons', () => {
		expect(p.questions.map((q) => q.kind)).toEqual(['frage', 'entscheidung', 'risiko', 'frage']);
		expect(p.questions[1]?.persons).toEqual(['TobiK', 'Chris']);
		expect(p.questions[3]?.done).toBe(true);
	});
	it('keeps absolute line numbers', () => {
		expect(NOTE.split('\n')[p.parallel[0]?.line ?? -1]).toBe('- [ ] Anfrage LA');
	});
});

describe('toggleTaskLine', () => {
	it('sets and removes the done date', () => {
		const on = toggleTaskLine('  - [ ] a #fokus', true, '2026-10-21');
		expect(on).toBe('  - [x] a #fokus ✅ 2026-10-21');
		expect(toggleTaskLine(on, false, '2026-10-22')).toBe('  - [ ] a #fokus');
		expect(toggleTaskLine('- [?] frage', true, '2026-10-21')).toBe('- [x] frage ✅ 2026-10-21');
	});
});

describe('parseStatusInput', () => {
	it('reads id, kw and text', () => {
		expect(parseStatusInput('S2 stockt: wartet auf S4', ['S2'])).toEqual({ id: 'S2', kw: 'stockt', text: 'wartet auf S4' });
		expect(parseStatusInput('nur ein satz', ['S2'])).toEqual({ text: 'nur ein satz' });
		expect(parseStatusInput('  ', [])).toBeNull();
	});
});

describe('computeSignals', () => {
	const topic = (id: string, prio: number, extra: Partial<Topic> = {}): Topic => ({
		id,
		name: id,
		path: id,
		prio,
		status: { kw: 'läuft', text: '' },
		needs: [],
		blockedBy: [],
		returnCondition: '',
		confidential: false,
		goals: [{ id: `${id}.0`, name: '', implicit: true, cd: false, metric: '', steps: [] }],
		parallel: [],
		questions: [],
		...extra,
	});
	const ev = (topicId: string, at: string): BoardEvent => ({ path: at, title: at, at, topic: topicId, conf: 1 });
	it('ranks energy, flags misallocation, slop and blockade', () => {
		const topics = [topic('S1', 1), topic('S2', 2), topic('S3', 3, { blockedBy: ['S1'] })];
		const events = [...Array.from({ length: 5 }, () => ev('S3', '2026-10-20')), ev('S2', '2026-10-01')];
		const s = computeSignals(topics, events, { ref: '2026-10-21', win: 28, staleDays: 14 });
		expect(s.get('S3')).toMatchObject({ energy: 5, energyRank: 1, misalloc: 2, misallocFlag: true, slop: true, blocked: true });
		expect(s.get('S1')).toMatchObject({ energy: 0, energyRank: 3, misalloc: -2, stale: true });
	});
});
