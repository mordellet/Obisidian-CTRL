// Parser for the body of topic notes and the board note (conventions:
// "Steuerungsboard - Konzept und Konventionen"). Pure string processing.
import type { Goal, ParsedBody, Question, QuestionKind, Step } from './model';

const TASK = /^(\s*)- \[(.)\] (.*)$/;
const DONE_AT = /✅\s*(\d{4}-\d{2}-\d{2})/;
const FOKUS = /(^|\s)#fokus\b/;
const PERSON = /@([\p{L}\p{N}_.-]+)/gu;
const GOAL = /^###\s+(\S+)\s+(.*)$/;
const CD = /(^|\s)#cd\b/;
const METRIC = /^>?\s*Messung:\s*(.*)$/;

type Section = 'ziele' | 'fragen' | 'parallel' | 'fokus' | 'other';

function sectionOf(heading: string): Section {
	const h = heading.toLowerCase();
	if (h.startsWith('ziele')) return 'ziele';
	if (h.startsWith('offene fragen')) return 'fragen';
	if (h.startsWith('parallel')) return 'parallel';
	if (h.startsWith('fokus')) return 'fokus';
	return 'other';
}

const KIND: Record<string, QuestionKind> = { '?': 'frage', '!': 'entscheidung', r: 'risiko', R: 'risiko' };

export function cleanText(s: string): string {
	return s
		.replace(DONE_AT, '')
		.replace(/📅\s*\d{4}-\d{2}-\d{2}/, '')
		.replace(FOKUS, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function indentLevel(ws: string): number {
	const n = ws.replace(/\t/g, '    ').length;
	return Math.floor(n / 2);
}

export function parseBody(content: string, topicId: string): ParsedBody {
	const lines = content.split('\n');
	let i = 0;
	// skip frontmatter, keep absolute line numbers
	if (lines[0]?.trim() === '---') {
		i = 1;
		while (i < lines.length && lines[i]?.trim() !== '---') i++;
		i++;
	}
	const goals: Goal[] = [];
	const parallel: Step[] = [];
	const questions: Question[] = [];
	const focus: Step[] = [];
	let section: Section = 'other';
	let goal: Goal | null = null;
	const implicit = (): Goal => {
		if (!goal) {
			goal = { id: `${topicId}.0`, name: 'Schritte', implicit: true, cd: false, metric: '', steps: [] };
			goals.push(goal);
		}
		return goal;
	};
	let counter = 0;
	for (; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (line.startsWith('## ')) {
			section = sectionOf(line.slice(3).trim());
			goal = null;
			continue;
		}
		if (section === 'ziele') {
			const g = GOAL.exec(line);
			if (g) {
				const name = g[2] ?? '';
				goal = { id: g[1] ?? '', name: name.replace(CD, ' ').trim(), implicit: false, cd: CD.test(name), metric: '', steps: [] };
				goals.push(goal);
				continue;
			}
			const m = METRIC.exec(line.trim());
			if (m && goal && !goal.implicit) {
				goal.metric = (m[1] ?? '').trim();
				continue;
			}
		}
		const t = TASK.exec(line);
		if (!t) continue;
		const mark = t[2] ?? ' ';
		const text = t[3] ?? '';
		const doneAt = DONE_AT.exec(text)?.[1];
		if (section === 'fragen') {
			const done = mark === 'x' || mark === 'X';
			questions.push({
				kind: KIND[mark] ?? 'frage',
				text: cleanText(text),
				done,
				doneAt,
				persons: [...text.matchAll(PERSON)].map((m) => m[1] ?? ''),
				line: i,
				raw: line,
			});
			continue;
		}
		if (section !== 'ziele' && section !== 'parallel' && section !== 'fokus') continue;
		const target = section === 'ziele' ? implicit() : null;
		counter++;
		const step: Step = {
			id: target ? `${target.id}.${target.steps.length + 1}` : `${topicId}.${section[0]}${counter}`,
			text: cleanText(text),
			done: mark === 'x' || mark === 'X',
			doneAt,
			fokus: FOKUS.test(text),
			level: indentLevel(t[1] ?? ''),
			line: i,
			raw: line,
			section,
			goalId: target?.id ?? '',
		};
		if (target) target.steps.push(step);
		else if (section === 'parallel') parallel.push(step);
		else focus.push(step);
	}
	return { goals, parallel, questions, focus };
}

/** Toggle a task line. Returns the new line. */
export function toggleTaskLine(line: string, done: boolean, today: string): string {
	const t = TASK.exec(line);
	if (!t) return line;
	let text = (t[3] ?? '').replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, '');
	if (done) text = `${text} ✅ ${today}`;
	return `${t[1] ?? ''}- [${done ? 'x' : ' '}] ${text}`;
}
