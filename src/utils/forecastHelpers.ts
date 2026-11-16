import {
  ForecastResult,
  ImpactType,
  LifePriority,
  TransitEvent,
} from '../types/astrology';
import {
  MonthRange,
  formatUtcDate,
  inclusiveDaySpan,
} from './forecastShared';

export function downloadIcs(icsContent: string, filename: string): void {
  const blob = new Blob([icsContent], {
    type: 'text/calendar;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function impactBadgeClasses(impact: ImpactType): string {
  switch (impact) {
    case 'Opportunity':
      return 'bg-emerald-500/20 border border-emerald-400/50 text-emerald-200';
    case 'Caution':
      return 'bg-amber-500/20 border border-amber-400/50 text-amber-200';
    case 'Milestone':
      return 'bg-violet-500/20 border border-violet-400/50 text-violet-200';
    default:
      return 'bg-slate-700/40 border border-slate-600 text-slate-300';
  }
}

export interface HeatmapCell {
  date: string;
  day: number;
  impacts: Set<ImpactType>;
  events: TransitEvent[];
}

export function buildMonthlyHeatmap(
  events: TransitEvent[],
  range: MonthRange,
  priorities: LifePriority[]
): HeatmapCell[][] {
  return priorities.map((priority) => {
    const cells: HeatmapCell[] = [];
    for (let day = 1; day <= range.daysInMonth; day++) {
      const date = formatUtcDate(range.year, range.month, day);
      const impacts = new Set<ImpactType>();
      const matched: TransitEvent[] = [];
      for (const ev of events) {
        if (!ev.topics.includes(priority)) continue;
        const span = inclusiveDaySpan(ev.date, ev.end_date || ev.date);
        if (span.includes(date)) {
          impacts.add(ev.impact_type);
          matched.push(ev);
        }
      }
      cells.push({ date, day, impacts, events: matched });
    }
    return cells;
  });
}

export interface SseMessage {
  event: string;
  data: string;
}

const SSE_MAX_BUFFER = 1024 * 1024;

export class SseParser {
  private pending = '';
  private buffer = '';
  private decoder = new TextDecoder();

  push(chunk: Uint8Array): SseMessage[] {
    this.pending += this.decoder.decode(chunk, { stream: true });
    if (this.pending.length + this.buffer.length > SSE_MAX_BUFFER) {
      throw new Error('SSE stream exceeded buffer limit');
    }
    this.normalize(false);
    return this.drain();
  }

  end(): SseMessage[] {
    this.pending += this.decoder.decode();
    this.normalize(true);
    const events = this.drain();
    if (this.buffer.trim().length > 0) {
      throw new Error('SSE stream ended with an incomplete event');
    }
    this.buffer = '';
    return events;
  }

  private normalize(flush: boolean): void {
    while (this.pending.length > 0) {
      const c = this.pending[0];
      if (c === '\r') {
        if (this.pending.length === 1 && !flush) break;
        if (this.pending.length > 1 && this.pending[1] === '\n') {
          this.pending = this.pending.slice(2);
        } else {
          this.pending = this.pending.slice(1);
        }
        this.buffer += '\n';
      } else {
        this.buffer += c;
        this.pending = this.pending.slice(1);
      }
    }
  }

  private drain(): SseMessage[] {
    const events: SseMessage[] = [];
    let sep: number;
    while ((sep = this.buffer.indexOf('\n\n')) >= 0) {
      const rawEvent = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep + 2);
      const msg = this.parseEventBlock(rawEvent);
      if (msg) events.push(msg);
    }
    return events;
  }

  private parseEventBlock(block: string): SseMessage | null {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
    }
    if (dataLines.length === 0 && event === 'message') return null;
    return { event, data: dataLines.join('\n') };
  }
}

export interface ForecastStreamHandlers {
  onProgress: (step: number) => void;
}

export async function readForecastSseStream(
  body: ReadableStream<Uint8Array>,
  handlers: ForecastStreamHandlers
): Promise<{ result: ForecastResult; profileId: string | null }> {
  const reader = body.getReader();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const messages = done
        ? parser.end()
        : value
        ? parser.push(value)
        : [];
      for (const msg of messages) {
        if (msg.event === 'progress') {
          const payload = JSON.parse(msg.data);
          if (typeof payload?.step === 'number') {
            handlers.onProgress(payload.step);
          }
        } else if (msg.event === 'result') {
          const payload = JSON.parse(msg.data);
          await reader.cancel().catch(() => {});
          return {
            result: payload.result as ForecastResult,
            profileId:
              typeof payload.profileId === 'string' ? payload.profileId : null,
          };
        } else if (msg.event === 'error') {
          const payload = JSON.parse(msg.data);
          await reader.cancel().catch(() => {});
          throw new Error(
            typeof payload?.error === 'string'
              ? payload.error
              : 'Forecast pipeline failed'
          );
        }
      }
      if (done) break;
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  } finally {
    reader.releaseLock();
  }
  throw new Error('Forecast stream ended without a result');
}
