import { TransitEvent } from '../types/astrology';
import { PRIORITY_LABELS, inclusiveDaySpan } from './forecastShared';

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n');
}

function toIcsDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function foldIcsLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= MAX_LINE_OCTETS) return line;

  const parts: string[] = [];
  let offset = 0;
  let limit = MAX_LINE_OCTETS;
  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    while (
      end < bytes.length &&
      end > offset &&
      (bytes[end] & 0xc0) === 0x80
    ) {
      end--;
    }
    if (end === offset) {
      end = offset + limit;
      while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end++;
    }
    parts.push(new TextDecoder().decode(bytes.subarray(offset, end)));
    offset = end;
    limit = MAX_LINE_OCTETS - 1;
  }
  return parts.join(CRLF + ' ');
}

function utcDtstamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function exclusiveEndDate(inclusiveEnd: string): string {
  const span = inclusiveDaySpan(inclusiveEnd, inclusiveEnd);
  const endMs = Date.parse(`${span[0]}T00:00:00Z`) + 86400000;
  return new Date(endMs).toISOString().slice(0, 10);
}

export function buildIcsCalendar(
  events: TransitEvent[],
  monthKey: string,
  now: Date = new Date()
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CelestialPulse//Monthly Forecast//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  const dtstamp = utcDtstamp(now);

  events.forEach((ev, index) => {
    const startDate = ev.date;
    const inclusiveEnd = ev.end_date || ev.date;
    const exclusiveEnd = exclusiveEndDate(inclusiveEnd);
    const uidSource = `${monthKey}|${index}|${ev.date}|${ev.end_date || ''}|${ev.title}|${ev.impact_type}`;
    const topicLabels = ev.topics
      .map((t) => PRIORITY_LABELS[t] || t)
      .join(', ');
    const descriptionParts = [
      ev.summary,
      `Impact: ${ev.impact_type}`,
      topicLabels ? `Life focus: ${topicLabels}` : '',
      ev.source_urls.length
        ? `Sources: ${ev.source_urls.join(' | ')}`
        : '',
    ].filter(Boolean);

    lines.push(
      'BEGIN:VEVENT',
      `UID:${fnv1a(uidSource)}-${index}@celestialpulse`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${toIcsDate(startDate)}`,
      `DTEND;VALUE=DATE:${toIcsDate(exclusiveEnd)}`,
      `SUMMARY:${escapeIcsText(`[${ev.impact_type}] ${ev.title}`)}`,
      `DESCRIPTION:${escapeIcsText(descriptionParts.join('\n\n'))}`,
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
