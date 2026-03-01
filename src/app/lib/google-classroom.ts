/**
 * Google Classroom API — Obtiene cursos y tareas del usuario
 * Funciona con scopes: courses.readonly + student-submissions.me.readonly
 */

import { googleAuth } from './google-auth';
import { todayStr } from './helpers';

const BASE = 'https://classroom.googleapis.com/v1';

// ─── Tipos de respuesta de Classroom API ──────────────────────────────────────

export interface ClassroomCourse {
  id: string;
  name: string;
  section?: string;
  courseState: 'ACTIVE' | 'ARCHIVED' | 'PROVISIONED' | 'DECLINED' | 'SUSPENDED';
}

export interface ClassroomCoursework {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  dueDate?: { year: number; month: number; day: number };
  dueTime?: { hours?: number; minutes?: number };
  maxPoints?: number;
  workType: string;
  state: string;
  alternateLink?: string;
  creationTime?: string;  // ISO timestamp de cuando se creó/asignó
}

export interface ClassroomSubmission {
  id: string;
  courseWorkId: string;
  courseId: string;
  courseWorkType: string;
  state: 'NEW' | 'CREATED' | 'TURNED_IN' | 'RETURNED' | 'RECLAIMED_BY_STUDENT';
  assignedGrade?: number;
  late?: boolean;
  creationTime?: string;
  updateTime?: string;
}

/** Tarea procesada lista para importar en FocusOS */
export interface ClassroomTask {
  courseId: string;
  courseName: string;
  courseworkId: string;
  title: string;
  description: string;
  dueDate: string;
  assignedDate: string;   // fecha en que se asignó en Classroom
  isDeliverable: boolean;
  submitted: boolean;
  selected: boolean;
}

// ─── API Calls ────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<T> {
  const token = googleAuth.getAccessToken();
  if (!token) throw new Error('No autenticado con Google');

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Classroom API ${res.status}: ${err}`);
  }

  return res.json();
}

/** Fetch que no lanza error en 403, retorna null */
async function apiFetchSafe<T>(url: string): Promise<T | null> {
  const token = googleAuth.getAccessToken();
  if (!token) return null;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return null;
  return res.json();
}

/** Obtiene los cursos activos del usuario */
export async function getCourses(): Promise<ClassroomCourse[]> {
  const data = await apiFetch<{ courses?: ClassroomCourse[] }>(
    `${BASE}/courses?courseStates=ACTIVE&pageSize=30`
  );
  return data.courses ?? [];
}

/** Obtiene las entregas del usuario en un curso (scope: student-submissions.me.readonly) */
export async function getMySubmissions(courseId: string): Promise<ClassroomSubmission[]> {
  const data = await apiFetch<{ studentSubmissions?: ClassroomSubmission[] }>(
    `${BASE}/courses/${courseId}/courseWork/-/studentSubmissions?pageSize=100`
  );
  return data.studentSubmissions ?? [];
}

/** Intenta obtener detalles de un coursework individual (puede fallar si no hay scope) */
async function getCourseworkDetails(courseId: string, courseworkId: string): Promise<ClassroomCoursework | null> {
  return apiFetchSafe<ClassroomCoursework>(
    `${BASE}/courses/${courseId}/courseWork/${courseworkId}`
  );
}

// ─── Función principal: obtener tareas pendientes ─────────────────────────────

/**
 * Obtiene las tareas pendientes usando submissions (que SÍ tenemos scope).
 * Luego intenta enriquecer con datos de coursework (si hay scope, los agrega).
 */
export async function getClassroomPendingTasks(): Promise<ClassroomTask[]> {
  const courses = await getCourses();
  const tasks: ClassroomTask[] = [];
  const today = todayStr();

  for (const course of courses) {
    const submissions = await getMySubmissions(course.id);

    // Filtrar solo entregas pendientes (no entregadas ni devueltas)
    const pending = submissions.filter(
      s => s.state === 'NEW' || s.state === 'CREATED' || s.state === 'RECLAIMED_BY_STUDENT'
    );

    for (const sub of pending) {
      // Intentar obtener detalles del coursework
      const cw = await getCourseworkDetails(course.id, sub.courseWorkId);

      let title = `Tarea de ${course.name}`;
      let description = '';
      let dueDateStr = today;

      if (cw) {
        title = cw.title;
        description = cw.description ?? '';

        if (cw.dueDate) {
          const y = cw.dueDate.year;
          const m = String(cw.dueDate.month).padStart(2, '0');
          const d = String(cw.dueDate.day).padStart(2, '0');
          if (cw.dueTime && cw.dueTime.hours !== undefined) {
            const hh = String(cw.dueTime.hours).padStart(2, '0');
            const mm = String(cw.dueTime.minutes ?? 0).padStart(2, '0');
            dueDateStr = `${y}-${m}-${d}T${hh}:${mm}`;
          } else {
            dueDateStr = `${y}-${m}-${d}`;
          }
        }
      }

      // Solo incluir tareas con fecha de 2026 en adelante
      const dueDateParsed = new Date(dueDateStr.includes('T') ? dueDateStr : dueDateStr + 'T23:59:00');
      if (dueDateParsed.getFullYear() < 2026) continue;

      // Evitar duplicados
      if (tasks.some(t => t.courseworkId === sub.courseWorkId)) continue;

      // Fecha de asignación: creationTime del coursework o del submission
      const rawCreation = cw?.creationTime ?? sub.creationTime ?? '';
      let assignedDate = '';
      if (rawCreation) {
        const d = new Date(rawCreation);
        if (!isNaN(d.getTime())) {
          const yy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          assignedDate = `${yy}-${mm}-${dd}`;
        }
      }

      tasks.push({
        courseId: course.id,
        courseName: course.name,
        courseworkId: sub.courseWorkId,
        title,
        description,
        dueDate: dueDateStr,
        assignedDate,
        isDeliverable: true,
        submitted: false,
        selected: true,
      });
    }
  }

  tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return tasks;
}
