/**
 * Google Classroom API — Obtiene cursos y tareas del usuario
 * Funciona con scopes: courses.readonly + student-submissions.me.readonly
 */

import { googleAuth } from './google-auth';

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

/** Intenta listar todo el coursework de un curso (batch, más eficiente) */
async function listCoursework(courseId: string): Promise<ClassroomCoursework[]> {
  try {
    const data = await apiFetch<{ courseWork?: ClassroomCoursework[] }>(
      `${BASE}/courses/${courseId}/courseWork?pageSize=100`
    );
    return data.courseWork ?? [];
  } catch {
    // Fallback: intentar con apiFetchSafe por si falla el scope
    const data = await apiFetchSafe<{ courseWork?: ClassroomCoursework[] }>(
      `${BASE}/courses/${courseId}/courseWork?pageSize=100`
    );
    return data?.courseWork ?? [];
  }
}

/** Fallback: obtener un coursework individual */
async function getCourseworkDetails(courseId: string, courseworkId: string): Promise<ClassroomCoursework | null> {
  return apiFetchSafe<ClassroomCoursework>(
    `${BASE}/courses/${courseId}/courseWork/${courseworkId}`
  );
}

/**
 * Obtiene las tareas pendientes de Classroom.
 * 1. Lista entregas del usuario y filtra SOLO pendientes ('NEW', 'CREATED', 'RECLAIMED_BY_STUDENT').
 *    Cualquier tarea entregada ('TURNED_IN') o calificada ('RETURNED') se excluye automáticamente.
 * 2. Aplica un filtro de ventana máxima de 40 días (ignora tareas cuya entrega o asignación exceda 40 días).
 */
export async function getClassroomPendingTasks(): Promise<ClassroomTask[]> {
  const courses = await getCourses();
  const tasks: ClassroomTask[] = [];
  const MAX_DAYS_WINDOW = 40;
  const now = Date.now();

  for (const course of courses) {
    const submissions = await getMySubmissions(course.id);

    // Filtrar SOLO entregas verdaderamente pendientes (NO entregadas ni calificadas)
    const pending = submissions.filter(
      s => s.state === 'NEW' || s.state === 'CREATED' || s.state === 'RECLAIMED_BY_STUDENT'
    );

    if (pending.length === 0) continue;

    // Cargar todo el coursework del curso en UNA llamada batch
    const allCoursework = await listCoursework(course.id);
    const cwMap = new Map<string, ClassroomCoursework>();
    for (const cw of allCoursework) cwMap.set(cw.id, cw);

    for (const sub of pending) {
      // Buscar en el mapa batch, fallback a individual si no está
      let cw = cwMap.get(sub.courseWorkId) ?? null;
      if (!cw) {
        cw = await getCourseworkDetails(course.id, sub.courseWorkId);
      }

      if (!cw) continue;

      // Fecha de asignación
      const rawCreation = cw.creationTime ?? sub.creationTime ?? '';
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

      const title = cw.title;
      const description = cw.description ?? '';

      // Construir fecha de entrega convirtiendo UTC → hora local
      let dueDateStr = '';
      if (cw.dueDate) {
        const y = cw.dueDate.year;
        const m = cw.dueDate.month - 1; // Date usa meses 0-indexed
        const d = cw.dueDate.day;
        const hh = cw.dueTime?.hours ?? 23;
        const mm = cw.dueTime?.minutes ?? 59;

        const utcDate = new Date(Date.UTC(y, m, d, hh, mm, 0));
        const localY = utcDate.getFullYear();
        const localM = String(utcDate.getMonth() + 1).padStart(2, '0');
        const localD = String(utcDate.getDate()).padStart(2, '0');
        const localHH = String(utcDate.getHours()).padStart(2, '0');
        const localMM = String(utcDate.getMinutes()).padStart(2, '0');

        dueDateStr = `${localY}-${localM}-${localD}T${localHH}:${localMM}`;
      }

      // ─── FILTRO 1: Ventana Máxima de 40 Días ────────────────────────────────
      if (dueDateStr) {
        const dueMs = new Date(dueDateStr).getTime();
        const diffDays = (dueMs - now) / (1000 * 60 * 60 * 24);
        // Excluir si la fecha de entrega excede +40 días en el futuro o -40 días en el pasado
        if (diffDays > MAX_DAYS_WINDOW || diffDays < -MAX_DAYS_WINDOW) continue;
      } else if (assignedDate) {
        const assignMs = new Date(assignedDate + 'T00:00:00').getTime();
        const diffDaysAssigned = (now - assignMs) / (1000 * 60 * 60 * 24);
        // Excluir si la tarea fue asignada hace más de 40 días
        if (diffDaysAssigned > MAX_DAYS_WINDOW) continue;
      }

      // Evitar duplicados en la lista de importación
      if (tasks.some(t => t.courseworkId === sub.courseWorkId)) continue;

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
