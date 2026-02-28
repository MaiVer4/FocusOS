/**
 * Google Classroom API — Obtiene cursos y tareas del usuario
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
}

export interface ClassroomSubmission {
  id: string;
  courseWorkId: string;
  state: 'NEW' | 'CREATED' | 'TURNED_IN' | 'RETURNED' | 'RECLAIMED_BY_STUDENT';
  assignedGrade?: number;
}

/** Tarea procesada lista para importar en FocusOS */
export interface ClassroomTask {
  courseId: string;
  courseName: string;
  courseworkId: string;
  title: string;
  description: string;
  dueDate: string;        // ISO string
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

/** Obtiene los cursos activos del usuario */
export async function getCourses(): Promise<ClassroomCourse[]> {
  const data = await apiFetch<{ courses?: ClassroomCourse[] }>(
    `${BASE}/courses?courseStates=ACTIVE&pageSize=30`
  );
  return data.courses ?? [];
}

/** Obtiene las tareas (coursework) de un curso */
export async function getCoursework(courseId: string): Promise<ClassroomCoursework[]> {
  const data = await apiFetch<{ courseWork?: ClassroomCoursework[] }>(
    `${BASE}/courses/${courseId}/courseWork?orderBy=dueDate+asc&pageSize=50`
  );
  return data.courseWork ?? [];
}

/** Obtiene las entregas del usuario en un curso */
export async function getMySubmissions(courseId: string): Promise<ClassroomSubmission[]> {
  const data = await apiFetch<{ studentSubmissions?: ClassroomSubmission[] }>(
    `${BASE}/courses/${courseId}/courseWork/-/studentSubmissions?pageSize=100`
  );
  return data.studentSubmissions ?? [];
}

// ─── Función principal: obtener tareas pendientes ─────────────────────────────

/**
 * Obtiene las tareas pendientes de todos los cursos activos.
 * Filtra las ya entregadas y las sin fecha de vencimiento.
 */
export async function getClassroomPendingTasks(): Promise<ClassroomTask[]> {
  const courses = await getCourses();
  const tasks: ClassroomTask[] = [];

  for (const course of courses) {
    const [coursework, submissions] = await Promise.all([
      getCoursework(course.id),
      getMySubmissions(course.id),
    ]);

    // Map de courseworkId → submission state
    const submissionMap = new Map<string, ClassroomSubmission>();
    for (const sub of submissions) {
      submissionMap.set(sub.courseWorkId, sub);
    }

    for (const cw of coursework) {
      // Construir fecha de vencimiento
      let dueDateStr = '';
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

      // Ignorar tareas sin fecha
      if (!dueDateStr) continue;

      // Verificar si ya fue entregada
      const sub = submissionMap.get(cw.id);
      const submitted = sub?.state === 'TURNED_IN' || sub?.state === 'RETURNED';

      // Solo incluir tareas futuras o no entregadas
      const dueMs = new Date(dueDateStr.includes('T') ? dueDateStr : dueDateStr + 'T23:59:00').getTime();
      if (submitted || dueMs < Date.now()) continue;

      tasks.push({
        courseId: course.id,
        courseName: course.name,
        courseworkId: cw.id,
        title: cw.title,
        description: cw.description ?? '',
        dueDate: dueDateStr,
        isDeliverable: true,
        submitted,
        selected: true,
      });
    }
  }

  // Ordenar por fecha de vencimiento
  tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return tasks;
}
