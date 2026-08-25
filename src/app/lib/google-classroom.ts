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

// ─── API Calls ────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<T> {
  const token = googleAuth.getAccessToken();
  if (!token) throw new Error('No autenticado con Google. Por favor conéctate primero.');

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    // Token expirado o revocado
    googleAuth.signOut();
    throw new Error('La sesión de Google expiró. Por favor vuelve a conectar tu cuenta.');
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Classroom API ${res.status}: ${err}`);
  }

  return res.json();
}

/** Fetch que no lanza error en 403 o 404, retorna null */
async function apiFetchSafe<T>(url: string): Promise<T | null> {
  const token = googleAuth.getAccessToken();
  if (!token) return null;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/** Obtiene los cursos activos del usuario (soporta rol estudiante y profesor) */
export async function getCourses(): Promise<ClassroomCourse[]> {
  try {
    // Intentar primero lista general de cursos activos
    const data = await apiFetch<{ courses?: ClassroomCourse[] }>(
      `${BASE}/courses?courseStates=ACTIVE&pageSize=50`
    );
    if (data.courses && data.courses.length > 0) {
      return data.courses;
    }
  } catch (err: any) {
    console.warn('[Classroom] getCourses general failed, trying studentId=me fallback:', err);
  }

  // Fallback con studentId=me
  const studentData = await apiFetchSafe<{ courses?: ClassroomCourse[] }>(
    `${BASE}/courses?studentId=me&courseStates=ACTIVE&pageSize=50`
  );
  return studentData?.courses ?? [];
}

/** Obtiene las entregas del usuario en un curso */
export async function getMySubmissions(courseId: string): Promise<ClassroomSubmission[]> {
  // Intentar con wildcard de studentSubmissions
  const data = await apiFetchSafe<{ studentSubmissions?: ClassroomSubmission[] }>(
    `${BASE}/courses/${courseId}/courseWork/-/studentSubmissions?pageSize=100`
  );
  if (data?.studentSubmissions) return data.studentSubmissions;

  // Fallback con userId=me
  const dataMe = await apiFetchSafe<{ studentSubmissions?: ClassroomSubmission[] }>(
    `${BASE}/courses/${courseId}/courseWork/-/studentSubmissions?userId=me&pageSize=100`
  );
  return dataMe?.studentSubmissions ?? [];
}

/** Intenta listar todo el coursework de un curso */
export async function listCoursework(courseId: string): Promise<ClassroomCoursework[]> {
  // 1. Intentar con filtro de solo publicados
  const dataPublished = await apiFetchSafe<{ courseWork?: ClassroomCoursework[] }>(
    `${BASE}/courses/${courseId}/courseWork?courseWorkStates=PUBLISHED&pageSize=100`
  );
  if (dataPublished?.courseWork && dataPublished.courseWork.length > 0) {
    return dataPublished.courseWork;
  }

  // 2. Intentar sin filtro de estado
  const dataAll = await apiFetchSafe<{ courseWork?: ClassroomCoursework[] }>(
    `${BASE}/courses/${courseId}/courseWork?pageSize=100`
  );
  return dataAll?.courseWork ?? [];
}

/** Fallback: obtener un coursework individual */
export async function getCourseworkDetails(courseId: string, courseworkId: string): Promise<ClassroomCoursework | null> {
  return apiFetchSafe<ClassroomCoursework>(
    `${BASE}/courses/${courseId}/courseWork/${courseworkId}`
  );
}

/**
 * Obtiene todas las tareas verdaderamente pendientes de Google Classroom.
 * Estrategia Resiliente:
 * 1. Para cada curso activo, obtiene tanto las tareas publicadas (courseWork) como el estado de entregas (submissions).
 * 2. Compara el estado: si la tarea ya fue entregada ('TURNED_IN') o calificada ('RETURNED'), se ignora.
 * 3. Si la tarea no tiene entrega registrada o su entrega está en estado 'NEW'/'CREATED'/'RECLAIMED_BY_STUDENT', se importa como pendiente.
 * 4. Convierte las fechas de entrega a hora local de manera precisa.
 */
export async function getClassroomPendingTasks(): Promise<ClassroomTask[]> {
  const courses = await getCourses();
  if (courses.length === 0) return [];

  const tasks: ClassroomTask[] = [];
  const processedCourseworkIds = new Set<string>();

  for (const course of courses) {
    // 1. Consultar tareas y entregas del curso en paralelo
    const [allCoursework, submissions] = await Promise.all([
      listCoursework(course.id),
      getMySubmissions(course.id),
    ]);

    // Mapa de entregas por courseWorkId
    const subMap = new Map<string, ClassroomSubmission>();
    for (const sub of submissions) {
      if (sub.courseWorkId) subMap.set(sub.courseWorkId, sub);
    }

    // ─── CASO A: Tareas encontradas vía listCoursework ──────────────────────
    for (const cw of allCoursework) {
      if (!cw.id || processedCourseworkIds.has(cw.id)) continue;

      const sub = subMap.get(cw.id);
      // Si la tarea fue entregada o devuelta calificada, no está pendiente
      if (sub && (sub.state === 'TURNED_IN' || sub.state === 'RETURNED')) {
        continue;
      }

      processedCourseworkIds.add(cw.id);

      // Fecha de asignación
      const rawCreation = cw.creationTime ?? sub?.creationTime ?? '';
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

      // Fecha de entrega en hora local
      let dueDateStr = '';
      if (cw.dueDate) {
        const y = cw.dueDate.year;
        const m = cw.dueDate.month - 1; // 0-indexed
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

      tasks.push({
        courseId: course.id,
        courseName: course.name,
        courseworkId: cw.id,
        title: cw.title || 'Tarea de Classroom',
        description: cw.description ?? '',
        dueDate: dueDateStr,
        assignedDate,
        isDeliverable: true,
        submitted: false,
        selected: true,
      });
    }

    // ─── CASO B: Fallback para submissions sin coursework en lote ──────────
    const pendingSubs = submissions.filter(
      (s) =>
        s.courseWorkId &&
        !processedCourseworkIds.has(s.courseWorkId) &&
        (s.state === 'NEW' || s.state === 'CREATED' || s.state === 'RECLAIMED_BY_STUDENT')
    );

    for (const sub of pendingSubs) {
      const cw = await getCourseworkDetails(course.id, sub.courseWorkId);
      if (!cw || processedCourseworkIds.has(cw.id)) continue;

      processedCourseworkIds.add(cw.id);

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

      let dueDateStr = '';
      if (cw.dueDate) {
        const y = cw.dueDate.year;
        const m = cw.dueDate.month - 1;
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

      tasks.push({
        courseId: course.id,
        courseName: course.name,
        courseworkId: cw.id,
        title: cw.title || 'Tarea de Classroom',
        description: cw.description ?? '',
        dueDate: dueDateStr,
        assignedDate,
        isDeliverable: true,
        submitted: false,
        selected: true,
      });
    }
  }

  // Ordenar: primero las que tienen fecha de entrega más próxima, luego las sin fecha
  tasks.sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return b.assignedDate.localeCompare(a.assignedDate);
  });

  return tasks;
}
