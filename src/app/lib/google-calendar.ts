/**
 * Google Calendar API — Obtiene eventos del calendario del usuario
 * Requiere scope: calendar.events.readonly
 */

import { googleAuth } from './google-auth';
import { dateToStr } from './helpers';

const BASE = 'https://www.googleapis.com/calendar/v3';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  status: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink?: string;
}

/** Evento procesado para mostrar en la UI */
export interface CalendarEventItem {
  id: string;
  title: string;
  description: string;
  date: string;        // YYYY-MM-DD
  startTime: string;   // HH:MM (vacío si all-day)
  endTime: string;     // HH:MM (vacío si all-day)
  isAllDay: boolean;
  location: string;
  selected: boolean;
}

// ─── API Call ─────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<T> {
  const token = googleAuth.getAccessToken();
  if (!token) throw new Error('No autenticado con Google');

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Calendar API ${res.status}: ${err}`);
  }

  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Limpia la descripción de texto basura inyectado por Google Tasks */
function cleanCalendarDescription(raw: string): string {
  if (!raw) return '';
  // Eliminar el bloque de Google Tasks: "No se guardarán los cambios..."
  const cleaned = raw
    .replace(/No se guardarán los cambios[^\n]*https:\/\/tasks\.google\.com\/task\/[^\s]*/gs, '')
    .replace(/Edits to the title, description[^\n]*https:\/\/tasks\.google\.com\/task\/[^\s]*/gs, '')
    .trim();
  return cleaned;
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Obtiene eventos del calendario primario desde hoy en adelante (2026+).
 * Solo devuelve eventos confirmados o tentativos.
 */
export async function getCalendarEvents(): Promise<CalendarEventItem[]> {
  const now = new Date();
  const timeMin = now.toISOString();
  // Buscar hasta 90 días en el futuro
  const futureDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const timeMax = futureDate.toISOString();

  const data = await apiFetch<{ items?: CalendarEvent[] }>(
    `${BASE}/calendars/primary/events?` +
    `timeMin=${encodeURIComponent(timeMin)}&` +
    `timeMax=${encodeURIComponent(timeMax)}&` +
    `singleEvents=true&` +
    `orderBy=startTime&` +
    `maxResults=100`
  );

  const events = data.items ?? [];

  return events
    .filter(ev => ev.status !== 'cancelled')
    .map(ev => {
      const isAllDay = !ev.start.dateTime;
      let date = '';
      let startTime = '';
      let endTime = '';

      if (isAllDay) {
        // All-day event: start.date = "2026-03-01"
        date = ev.start.date ?? '';
      } else {
        // Timed event: start.dateTime = "2026-03-01T09:00:00-05:00"
        const startDt = new Date(ev.start.dateTime!);
        const endDt = new Date(ev.end.dateTime!);
        date = dateToStr(startDt);
        startTime = startDt.toTimeString().slice(0, 5); // HH:MM
        endTime = endDt.toTimeString().slice(0, 5);
      }

      // Filtrar solo 2026+
      const year = parseInt(date.split('-')[0]);
      if (year < 2026) return null;

      return {
        id: ev.id,
        title: ev.summary || '(Sin título)',
        description: cleanCalendarDescription(ev.description ?? ''),
        date,
        startTime,
        endTime,
        isAllDay,
        location: ev.location ?? '',
        selected: true,
      };
    })
    .filter((ev): ev is CalendarEventItem => ev !== null);
}
