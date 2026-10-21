// Domain model of the steering board. Pure data, no dependencies.

export const STATUS_KWS = ['läuft', 'stockt', 'blockiert', 'fertig', 'tot', 'pausiert'] as const;
export type StatusKw = (typeof STATUS_KWS)[number];

export function isStatusKw(v: string): v is StatusKw {
	return (STATUS_KWS as readonly string[]).includes(v);
}

/** ISO date `YYYY-MM-DD`. */
export type IsoDate = string;

export interface Step {
	id: string;
	text: string;
	done: boolean;
	doneAt?: IsoDate;
	fokus: boolean;
	/** 0 = Schritt, 1+ = Teilschritt */
	level: number;
	/** 0-based line in the source file (for write-back). */
	line: number;
	raw: string;
	section: 'ziele' | 'parallel' | 'fokus';
	goalId: string;
}

export type QuestionKind = 'frage' | 'entscheidung' | 'risiko';

export interface Question {
	kind: QuestionKind;
	text: string;
	done: boolean;
	doneAt?: IsoDate;
	persons: string[];
	line: number;
	raw: string;
}

export interface Goal {
	id: string;
	name: string;
	implicit: boolean;
	steps: Step[];
}

export interface Status {
	kw: StatusKw;
	text: string;
	at?: IsoDate;
}

export interface Topic {
	id: string;
	name: string;
	path: string;
	prio: number;
	status: Status;
	needs: string[];
	blockedBy: string[];
	returnCondition: string;
	reviewed?: IsoDate;
	confidential: boolean;
	goals: Goal[];
	parallel: Step[];
	questions: Question[];
}

/** Activity evidence: a note that refers to a topic (or to nothing). */
export interface BoardEvent {
	path: string;
	title: string;
	at: IsoDate;
	topic: string | null;
	goal?: string;
	/** 1.0 explicit property, 0.6 link */
	conf: number;
}

export interface MainSection {
	path: string;
	mainTrack: string;
	staleDays: number;
	focus: Step[];
	questions: Question[];
}

export interface BoardData {
	main: MainSection | null;
	topics: Topic[];
	events: BoardEvent[];
}

export interface ParsedBody {
	goals: Goal[];
	parallel: Step[];
	questions: Question[];
	focus: Step[];
}
