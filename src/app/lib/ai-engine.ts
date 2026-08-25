/**
 * ─── AI Engine (Multi-provider) ──────────────────────────────────────────────
 *
 * Motor de IA que soporta múltiples proveedores:
 *  • Groq  — GRATIS, rápido, Llama 3.3 70B (recomendado)
 *  • Gemini — Free tier con límites de cuota
 *
 * Groq usa el formato OpenAI-compatible (REST), no necesita paquete extra.
 * Gemini usa el SDK @google/generative-ai.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { Block, BlockType, Task, UserSettings, DailyMetrics } from './types';
import { isRoutineLabel } from './helpers';
import { LearnedProfile } from './learning-engine';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type AIProvider = 'groq' | 'gemini';

export interface AIGeneratedBlock {
  type: BlockType;
  label: string;
  startTime: string;
  endTime: string;
  priority: 'high' | 'medium' | 'low';
  taskId?: string;
  reason?: string;
}

export interface AIScheduleResult {
  blocks: AIGeneratedBlock[];
  insights: string[];
  confidence: number;
}

export interface AIDailySummary {
  analysis: string;
  suggestions: string[];
  productivityTips: string[];
}

// ─── Config por proveedor ────────────────────────────────────────────────────

const FALLBACK_GROQ_MODELS = [
  'llama-3.1-8b-instant',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'qwen/qwen3.6-27b',
];
const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ─── Utilidades ──────────────────────────────────────────────────────────────

/** Elimina caracteres invisibles, prefijos "Bearer" o comillas accidentales de la API key */
export function sanitizeApiKey(key: string): string {
  if (!key) return '';
  return key
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

/** Filtra y ordena modelos activos de Groq para chat, ignorando modelos deprecados o de audio */
function filterChatModels(models: string[]): string[] {
  const preferred = [
    'llama-3.1-8b-instant',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'llama-3.3-70b-versatile',
    'qwen/qwen3.6-27b',
  ];
  const excluded = [
    'whisper',
    'llama-prompt-guard',
    'canopylabs',
    'safeguard',
    'orpheus',
    'gemma2-9b-it',
    'llama3-8b-8192',
    'llama3-70b-8192',
    'mixtral-8x7b-32768',
  ];

  const valid = models.filter((id) => !excluded.some((e) => id.toLowerCase().includes(e)));

  valid.sort((a, b) => {
    const idxA = preferred.indexOf(a);
    const idxB = preferred.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return 0;
  });

  return valid;
}

/** Extrae y sanitiza JSON de respuestas de IA, removiendo tags de pensamiento <think> y markdown */
export function extractJSON<T = any>(raw: string): T {
  let cleaned = raw.trim();
  // Quitar bloques de pensamiento <think>...</think>
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Quitar markdown ```json ... ```
  cleaned = cleaned
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Aislar el objeto JSON delimitado por '{' y '}'
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  return JSON.parse(cleaned);
}

let _geminiClient: GoogleGenerativeAI | null = null;
let _geminiClientKey: string | null = null;

export function resetAIClient(): void {
  _geminiClient = null;
  _geminiClientKey = null;
}

// ─── Groq (OpenAI-compatible REST con Auto-Discovery) ────────────────────────

async function groqGenerate(apiKey: string, prompt: string): Promise<string> {
  const key = sanitizeApiKey(apiKey);
  let candidateModels = [...FALLBACK_GROQ_MODELS];

  // 1. Intentar descubrir dinámicamente qué modelos están activos para esta key
  try {
    const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });
    if (modelsRes.ok) {
      const data = await modelsRes.json();
      if (Array.isArray(data.data) && data.data.length > 0) {
        const availableIds = data.data.map((m: any) => m.id as string);
        const discovered = filterChatModels(availableIds);
        if (discovered.length > 0) {
          candidateModels = discovered;
        }
      }
    }
  } catch {
    // Si falla la consulta de modelos, continuar con la lista estática
  }

  let lastError: any = null;

  for (const model of candidateModels) {
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'Eres un asistente experto en productividad y organización. Responde única y exclusivamente con un objeto JSON válido, sin explicaciones ni markdown.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.6,
          max_tokens: 4096,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        console.warn(`[AI] Groq modelo "${model}" error (${res.status}):`, errBody);
        lastError = new Error(`Groq ${res.status}: ${errBody}`);
        // Probar siguiente modelo para cualquier error recuperable
        continue;
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? '';
      if (content && content.trim().length > 0) return content;
    } catch (err: any) {
      lastError = err;
      console.warn(`[AI] Excepción con modelo Groq "${model}":`, err?.message);
      continue;
    }
  }
  throw lastError ?? new Error('No se pudo generar respuesta con ningún modelo disponible en Groq.');
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

async function geminiGenerate(apiKey: string, prompt: string): Promise<string> {
  const key = sanitizeApiKey(apiKey);
  if (!_geminiClient || _geminiClientKey !== key) {
    _geminiClient = new GoogleGenerativeAI(key);
    _geminiClientKey = key;
  }

  let lastError: any = null;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = _geminiClient.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err: any) {
      lastError = err;
      const msg = err?.message ?? '';
      if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) {
        console.warn(`[AI] Gemini ${modelName} sin cuota, probando siguiente...`);
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error('Todos los modelos Gemini agotaron su cuota.');
}

// ─── Generador unificado ─────────────────────────────────────────────────────

async function generate(provider: AIProvider, apiKey: string, prompt: string): Promise<string> {
  if (provider === 'groq') return groqGenerate(apiKey, prompt);
  return geminiGenerate(apiKey, prompt);
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

function buildContextPrompt(
  settings: UserSettings,
  profile: LearnedProfile | null,
  recentMetrics: DailyMetrics[],
  dayOfWeek?: number,
): string {
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const lines: string[] = [
    '=== CONTEXTO DEL USUARIO ===',
    `Hora de despertar: ${settings.wakeTime}`,
    `Hora de dormir: ${settings.sleepTime}`,
    `Pico de energía: ${settings.peakEnergyTime}`,
    `Bloques profundos: ${settings.dailyDeepBlocksMin}-${settings.dailyDeepBlocksMax} diarios, ${settings.deepBlockDuration} min c/u`,
    `Ejercicio: ${settings.exerciseMandatory ? `obligatorio, ${settings.exerciseDuration} min` : 'opcional'}`,
    `Máx. redes sociales: ${settings.socialMediaMaxMinutes} min/día`,
    '',
    '=== ESTRUCTURA HORARIA DEL DÍA (OBLIGATORIO RESPETAR) ===',
  ];

  if (isWeekend) {
    lines.push(
      `Tipo de día: FIN DE SEMANA (${dayOfWeek === 6 ? 'sábado' : 'domingo'})`,
      `Todo el día es libre desde ${settings.wakeTime} hasta ${settings.sleepTime}.`,
      `NO hay actividades formales. Puedes programar bloques de estudio/ejercicio/descanso libremente.`,
      `Ventana disponible: ${settings.wakeTime} - ${settings.sleepTime}`,
    );
  } else {
    lines.push(
      `Tipo de día: ENTRE SEMANA (lunes a viernes)`,
      `Horario SENA (formación): ${settings.scheduleStartTime} - ${settings.scheduleEndTime}`,
      `Hora de llegada a casa tras formales: ${settings.arrivalTime}`,
      '',
      '⚠️ VENTANAS DE TIEMPO DISPONIBLES (solo puedes programar bloques aquí):',
      `  🌅 MAÑANA: ${settings.wakeTime} - ${settings.scheduleStartTime}`,
      `     → Rutina matutina, desayuno, estudio ligero, prepararse`,
      `  🏫 FORMAL (BLOQUEADO): ${settings.scheduleStartTime} - ${settings.scheduleEndTime}`,
      `     → PROHIBIDO programar bloques de estudio/ejercicio aquí. Solo UN bloque tipo "rest" o "light" con label de la actividad formal.`,
      `  🚌 TRANSICIÓN: ${settings.scheduleEndTime} - ${settings.arrivalTime}`,
      `     → Transporte de regreso. Solo bloque tipo "rest".`,
      `  🌙 TARDE/NOCHE: ${settings.arrivalTime} - ${settings.sleepTime}`,
      `     → Cena, bloques profundos de estudio, ejercicio, descanso, prepararse para dormir`,
    );
  }

  if (profile && profile.totalBlocksAnalyzed >= 5) {
    lines.push('', '=== PERFIL DE PRODUCTIVIDAD APRENDIDO ===');
    lines.push(`Bloques analizados: ${profile.totalBlocksAnalyzed}`);
    lines.push(`Duración óptima deep: ${profile.optimalDeepDuration} min`);
    lines.push(`Duración óptima light: ${profile.optimalLightDuration} min`);
    if (profile.bestDeepSlots.length > 0)
      lines.push(`Mejores franjas deep: ${profile.bestDeepSlots.join(', ')}`);
    if (profile.bestLightSlots.length > 0)
      lines.push(`Mejores franjas light: ${profile.bestLightSlots.join(', ')}`);
    for (const type of ['deep', 'light', 'exercise'] as BlockType[]) {
      const ts = profile.typeStats[type];
      if (ts.total > 0)
        lines.push(`  ${type}: ${ts.total} bloques, ${Math.round(ts.successRate * 100)}% éxito, ${ts.avgDuration} min prom.`);
    }
    const cats = Object.entries(profile.categoryStats);
    if (cats.length > 0) {
      lines.push('Rendimiento por categoría:');
      for (const [cat, cs] of cats)
        lines.push(`  ${cat}: ${cs.total} bloques, ${Math.round(cs.successRate * 100)}% éxito`);
    }
  }

  if (recentMetrics.length > 0) {
    lines.push('', '=== MÉTRICAS RECIENTES ===');
    for (const m of recentMetrics.slice(-7))
      lines.push(`  ${m.date}: ${m.blocksCompleted}/${m.blocksPlanned} completados, ${m.deepWorkHours.toFixed(1)}h deep, score ${m.disciplineScore}`);
  }

  return lines.join('\n');
}

function buildTasksPrompt(tasks: Task[]): string {
  if (tasks.length === 0) {
    return `=== TAREAS PENDIENTES ===
Actualmente el usuario NO tiene tareas pendientes registradas.
⚠️ PROHIBICIÓN ESTRICTA: NO inventes tareas ni materias ficticias. Los bloques de estudio deben llamarse genéricamente "Bloque Profundo 1", "Bloque Profundo 2", "Estudio Ligero", "Repaso" o "Proyectos Personales" con "taskId": null.`;
  }
  const lines = [
    '=== TAREAS PENDIENTES DEL USUARIO (USA ÚNICAMENTE ESTAS TAREAS) ===',
    '⚠️ PROHIBICIÓN ESTRICTA: ESTÁ TOTALMENTE PROHIBIDO INVENTAR MATERIAS O TAREAS QUE NO ESTÉN EN ESTA LISTA:',
  ];
  for (const t of tasks) {
    const due = t.dueDate ? `entrega: ${t.dueDate.split('T')[0]}` : 'sin fecha';
    const cat = t.category ? `[${t.category}]` : '';
    const deliverable = t.isDeliverable ? '⚠️ ENTREGABLE CRÍTICO' : '';
    const sub = t.subtasks
      ? `(${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length} sub)`
      : '';
    lines.push(
      `- ID:"${t.id}" | Materia/Tarea:"${t.subject}" ${cat} | Dificultad:${t.difficulty} | ${due} | ${t.status} ${deliverable} ${sub}`
    );
    if (t.description) lines.push(`  Descripción: ${t.description}`);
  }
  return lines.join('\n');
}

function buildExistingBlocksPrompt(blocks: Block[]): string {
  if (blocks.length === 0) return 'No hay bloques previos hoy.';
  const lines = ['=== BLOQUES EXISTENTES HOY ==='];
  for (const b of blocks) {
    const task = b.task ? `→ "${b.task.subject}"` : '';
    lines.push(`  ${b.startTime}-${b.endTime} [${b.type}] ${b.label ?? ''} (${b.status}) ${task}`);
  }
  return lines.join('\n');
}

// ─── Funciones principales ───────────────────────────────────────────────────

export async function generateAISchedule(
  provider: AIProvider,
  apiKey: string,
  date: string,
  dayOfWeek: number,
  tasks: Task[],
  settings: UserSettings,
  profile: LearnedProfile | null,
  recentMetrics: DailyMetrics[],
  existingBlocks: Block[]
): Promise<AIScheduleResult> {
  const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const prompt = `Eres un asistente experto en productividad y gestión del tiempo. Genera un horario diario optimizado para un estudiante.

${buildContextPrompt(settings, profile, recentMetrics, dayOfWeek)}

${buildTasksPrompt(tasks)}

${buildExistingBlocksPrompt(existingBlocks)}

=== INSTRUCCIONES ===
Genera un horario optimizado para: ${date} (${dayNames[dayOfWeek]})

REGLAS ESTRICTAS DE HORARIO (OBLIGATORIO):
- ❌ PROHIBIDO crear bloques que empiecen ANTES de ${settings.wakeTime} o terminen DESPUÉS de ${settings.sleepTime}
${
  isWeekend
    ? `- ✅ Es fin de semana: todo el rango ${settings.wakeTime} - ${settings.sleepTime} está disponible libremente`
    : `- ❌ PROHIBIDO crear bloques de estudio (deep/light) entre ${settings.scheduleStartTime} y ${settings.scheduleEndTime} — el usuario está en el SENA
- ❌ PROHIBIDO crear bloques de estudio entre ${settings.scheduleEndTime} y ${settings.arrivalTime} — el usuario está en transporte
- ❌ PROHIBIDO crear bloques DEEP en la mañana (${settings.wakeTime} a ${settings.scheduleStartTime}) — los bloques profundos son SOLO en la noche
- ✅ Ventana MAÑANA: ${settings.wakeTime} a ${settings.scheduleStartTime} → rutina, desayuno, solo estudio LIGERO (type:"light")
- ✅ Bloque SENA: colocar UN SOLO bloque (type:"rest", label:"SENA") de ${settings.scheduleStartTime} a ${settings.scheduleEndTime}. SIN taskId.
- ✅ Ventana TARDE/NOCHE: ${settings.arrivalTime} a ${settings.sleepTime} → cena, bloques PROFUNDOS (deep), ejercicio, descanso`
}

REGLAS GENERALES:
1. Cada bloque: type (deep|light|exercise|rest), label, startTime (HH:mm), endTime (HH:mm), priority (high|medium|low), taskId (string o null), reason (string)
2. ⚠️ ASIGNACIÓN ESTRICTA DE TAREAS:
   - Usa ÚNICAMENTE los IDs exactos de la lista "=== TAREAS PENDIENTES DEL USUARIO ===" para la propiedad "taskId".
   - Si asignas una tarea real, usa el nombre exacto de la materia como "label".
   - NUNCA inventes nombres de materias ni tareas ficticias.
   - Si un bloque de estudio no tiene tarea de la lista, coloca "taskId": null y nómbralo "Bloque Profundo 1", "Bloque Profundo 2", "Estudio Ligero" o "Repaso General".
3. Tareas urgentes/difíciles en franjas de mayor productividad (pico de energía: ${settings.peakEnergyTime})
4. Descansos de 5-15 min entre bloques de estudio
5. Incluir ejercicio si es obligatorio (${settings.exerciseMandatory ? 'SÍ es obligatorio' : 'no es obligatorio'})
6. Sin solapamientos entre bloques
7. Comidas (Desayuno, Almuerzo, Cena) → SIEMPRE tipo "rest", SIN taskId ("taskId": null)
8. Redes sociales, preparación para dormir, transporte, y cualquier rutina no-académica → SIEMPRE tipo "rest", SIN taskId

Responde SOLO con JSON válido (sin markdown, sin backticks):
{
  "blocks": [{"type":"deep","label":"nombre","startTime":"HH:mm","endTime":"HH:mm","priority":"high","taskId":"id_real_o_null","reason":"razón"}],
  "insights": ["observación 1"],
  "confidence": 0.85
}`;

  try {
    const raw = await generate(provider, apiKey, prompt);
    const parsed = extractJSON<AIScheduleResult>(raw);
    if (!Array.isArray(parsed.blocks)) throw new Error('Respuesta sin bloques válidos');

    // Validación de formato básico
    parsed.blocks = parsed.blocks.filter(
      (b) =>
        b.type &&
        b.startTime &&
        b.endTime &&
        b.label &&
        ['deep', 'light', 'exercise', 'rest'].includes(b.type) &&
        /^\d{2}:\d{2}$/.test(b.startTime) &&
        /^\d{2}:\d{2}$/.test(b.endTime)
    );

    // ─── Validación de horario base ──────────────────────────────────
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const wakeMin = toMin(settings.wakeTime);
    const sleepMin = toMin(settings.sleepTime);
    const formalStartMin = toMin(settings.scheduleStartTime);
    const formalEndMin = toMin(settings.scheduleEndTime);
    const arrivalMin = toMin(settings.arrivalTime);

    parsed.blocks = parsed.blocks.filter((b) => {
      const start = toMin(b.startTime);
      const end = toMin(b.endTime);

      // Rechazar bloques fuera del rango despertar-dormir
      if (start < wakeMin || end > sleepMin) {
        console.warn(
          `[AI] Bloque "${b.label}" (${b.startTime}-${b.endTime}) descartado: fuera de horario ${settings.wakeTime}-${settings.sleepTime}`
        );
        return false;
      }

      // Entre semana: rechazar bloques deep en la mañana (solo van en la noche)
      if (!isWeekend && b.type === 'deep' && start < formalStartMin) {
        console.warn(
          `[AI] Bloque deep "${b.label}" (${b.startTime}-${b.endTime}) descartado: bloques profundos solo en la noche`
        );
        return false;
      }

      // Entre semana: rechazar bloques de estudio/ejercicio durante horario formal
      if (!isWeekend && (b.type === 'deep' || b.type === 'exercise')) {
        if (start < formalEndMin && end > formalStartMin) {
          console.warn(
            `[AI] Bloque "${b.label}" (${b.startTime}-${b.endTime}) descartado: se solapa con horario formal ${settings.scheduleStartTime}-${settings.scheduleEndTime}`
          );
          return false;
        }
      }

      // Entre semana: rechazar bloques de estudio en la franja de transporte
      if (
        !isWeekend &&
        (b.type === 'deep' || b.type === 'light') &&
        b.label?.toLowerCase().indexOf('formal') === -1
      ) {
        if (start >= formalEndMin && start < arrivalMin) {
          console.warn(
            `[AI] Bloque "${b.label}" (${b.startTime}-${b.endTime}) descartado: franja de transporte ${settings.scheduleEndTime}-${settings.arrivalTime}`
          );
          return false;
        }
      }

      return true;
    });

    // Validar taskIds y desinfectar materias/tareas inventadas
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const assignedTasks = new Set<string>();
    let deepNum = 1;
    let lightNum = 1;

    for (const b of parsed.blocks) {
      if (b.type === 'rest' || b.type === 'exercise' || isRoutineLabel(b.label ?? '')) {
        b.type = isRoutineLabel(b.label ?? '') ? 'rest' : b.type;
        b.taskId = undefined;
        continue;
      }

      // Bloques de estudio
      if (b.taskId && taskMap.has(b.taskId)) {
        // Tarea legítima
        assignedTasks.add(b.taskId);
        const legitimateTask = taskMap.get(b.taskId)!;
        b.label = legitimateTask.subject;
      } else {
        // Si no tiene taskId o la IA inventó un ID falso:
        // Intentar enlazar por coincidencia exacta con alguna tarea real del usuario
        const matched = tasks.find(
          (t) =>
            !assignedTasks.has(t.id) &&
            (b.label?.toLowerCase().includes(t.subject.toLowerCase()) ||
              t.subject.toLowerCase().includes(b.label?.toLowerCase() ?? ''))
        );

        if (matched) {
          b.taskId = matched.id;
          b.label = matched.subject;
          assignedTasks.add(matched.id);
        } else {
          // No es una tarea real del usuario: LIMPIAR el label para no mostrar tareas ficticias
          b.taskId = undefined;
          if (b.type === 'deep') {
            b.label = `Bloque Profundo ${deepNum++}`;
          } else {
            b.label = `Estudio Ligero ${lightNum++}`;
          }
        }
      }
    }

    parsed.confidence =
      typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
    parsed.insights = Array.isArray(parsed.insights) ? parsed.insights : [];
    return parsed;
  } catch (error: any) {
    console.error('Error generando horario con IA:', error);
    throw new Error(`Error de IA: ${error.message ?? 'No se pudo generar el horario'}`);
  }
}

export async function getAIDailySummary(
  provider: AIProvider,
  apiKey: string,
  date: string,
  blocks: Block[],
  tasks: Task[],
  settings: UserSettings,
  profile: LearnedProfile | null,
  metrics: DailyMetrics[],
): Promise<AIDailySummary> {
  const completed = blocks.filter(b => b.status === 'completed');
  const failed = blocks.filter(b => b.status === 'failed');
  const pending = blocks.filter(b => b.status === 'pending');

  const prompt = `Eres un coach de productividad. Analiza el día del estudiante.

${buildContextPrompt(settings, profile, metrics, undefined)}

=== RESULTADOS DEL DÍA ${date} ===
Completados: ${completed.length} | Fallidos: ${failed.length} | Pendientes: ${pending.length}

${blocks.map(b => {
  const task = b.task ? `→ "${b.task.subject}"` : '';
  return `  ${b.startTime}-${b.endTime} [${b.type}] ${b.label ?? ''} → ${b.status} (${b.interruptions} int.) ${task}`;
}).join('\n')}

Tareas sin completar:
${tasks.filter(t => t.status !== 'terminada').map(t => `  - "${t.subject}" (${t.difficulty}, ${t.dueDate || 'sin fecha'})`).join('\n')}

Responde SOLO con JSON válido (sin markdown, sin backticks):
{"analysis":"párrafo breve","suggestions":["sug 1"],"productivityTips":["tip 1"]}`;

  try {
    const raw = await generate(provider, apiKey, prompt);
    return extractJSON<AIDailySummary>(raw);
  } catch (error: any) {
    console.error('Error resumen IA:', error);
    return { analysis: 'No se pudo analizar el día.', suggestions: [], productivityTips: [] };
  }
}

/**
 * Valida que una API key funciona correctamente.
 * Retorna { valid: boolean, error?: string }.
 */
export async function validateApiKey(
  provider: AIProvider,
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  const key = sanitizeApiKey(apiKey);
  if (!key || key.length < 8) {
    return { valid: false, error: 'La clave ingresada está vacía o es demasiado corta.' };
  }

  if (provider === 'groq') {
    if (!key.startsWith('gsk_')) {
      return {
        valid: false,
        error: 'Las claves de Groq comienzan con "gsk_". Asegúrate de copiar el "Secret Key" (no el nombre) en console.groq.com/keys',
      };
    }

    try {
      // 1. Probar endpoint de listado de modelos
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });

      if (res.ok || res.status === 429) {
        return { valid: true };
      }

      if (res.status === 401) {
        // Intentar fallback con chat completion
        try {
          const testMsg = await groqGenerate(key, 'ping');
          if (testMsg && testMsg.length > 0) return { valid: true };
        } catch {
          // Si ambos fallan con 401
          return {
            valid: false,
            error: 'Los servidores de Groq rechazaron la clave (401 Unauthorized). La clave es incorrecta, fue revocada o expiró. Genera una nueva en console.groq.com/keys',
          };
        }
      }

      const errData = await res.json().catch(() => null);
      const errMsg = errData?.error?.message || `Error de Groq (HTTP ${res.status})`;
      return { valid: false, error: errMsg };
    } catch (fetchErr: any) {
      // Fallback: probar chat completion si /models fue bloqueado por firewall/cors
      try {
        const text = await groqGenerate(key, 'ping');
        if (text && text.length > 0) return { valid: true };
      } catch (err: any) {
        const msg = err?.message ?? '';
        if (msg.includes('429') || msg.includes('rate') || msg.includes('quota')) {
          return { valid: true };
        }
        return { valid: false, error: msg || 'No se pudo establecer conexión con api.groq.com' };
      }
    }
  } else {
    // Proveedor Gemini
    try {
      const text = await geminiGenerate(key, 'ping');
      return { valid: text.length > 0 };
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) {
        return { valid: true };
      }
      return { valid: false, error: msg || 'API Key de Gemini inválida' };
    }
  }

  return { valid: false, error: 'No se pudo verificar la API key' };
}
