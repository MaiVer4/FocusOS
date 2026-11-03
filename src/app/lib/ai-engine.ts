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
import { Block, BlockType, Task, UserSettings, DailyMetrics, MealId, MealCustomOverride } from './types';
import { isRoutineLabel } from './helpers';
import { LearnedProfile } from './learning-engine';
import {
  CLINICAL_PROFILE,
  MEAL_PROTOCOL,
  WORKOUT_SPLITS,
  getScheduledSplitForDayOfWeek,
  buildLocalMealSubstitution,
} from './personal-protocol';

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

/** Transforma errores técnicos de Google Generative AI o Groq en mensajes claros y accionables */
export function formatAIErrorMessage(error: unknown, provider?: AIProvider): string {
  const rawMsg = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (
    rawMsg.includes('API_KEY_INVALID') ||
    rawMsg.includes('API key not valid') ||
    rawMsg.includes('400 ] API key not valid')
  ) {
    return 'La clave API de Gemini no es válida o ha sido revocada. Ve a Ajustes > Asistente IA para actualizarla con una clave nueva de Google AI Studio (aistudio.google.com) o cámbiate a Groq (100% gratis).';
  }

  if (rawMsg.includes('gsk_') && (rawMsg.includes('Gemini') || provider === 'gemini')) {
    return 'Has ingresado una clave de Groq (inicia con "gsk_") con el proveedor Gemini seleccionado. Cámbiate al proveedor Groq en Ajustes o ingresa una clave de Google AI Studio (AIza...).';
  }

  if (rawMsg.includes('AIza') && (rawMsg.includes('Groq') || provider === 'groq')) {
    return 'Has ingresado una clave de Gemini (inicia con "AIza") con el proveedor Groq seleccionado. Cámbiate al proveedor Gemini en Ajustes o ingresa una clave de Groq (gsk_...).';
  }

  if (rawMsg.includes('401') || rawMsg.includes('Unauthorized') || rawMsg.includes('rechazaron la clave')) {
    return 'La clave API de IA no fue autorizada (401). Verifica tu clave en Ajustes > Asistente IA.';
  }

  if (
    rawMsg.includes('429') ||
    rawMsg.includes('quota') ||
    rawMsg.includes('rate') ||
    rawMsg.includes('RESOURCE_EXHAUSTED') ||
    rawMsg.includes('agotaron su cuota')
  ) {
    return 'Límite de cuota alcanzado temporalmente en la IA. Espera 1 minuto o prueba alternar a Groq en Ajustes.';
  }

  if (
    rawMsg.includes('JSON') ||
    rawMsg.includes('indicó') ||
    rawMsg.includes('respondi') ||
    rawMsg.includes('inválido o incompleto')
  ) {
    return 'La IA respondió con un formato incompleto o inválido. Intenta de nuevo en unos momentos.';
  }

  if (rawMsg.includes('[GoogleGenerativeAI Error]:')) {
    const clean = rawMsg.replace(/\[GoogleGenerativeAI Error\]:\s*/g, '').split('[{')[0].trim();
    return `Error en Gemini: ${clean}`;
  }

  return rawMsg || 'No se pudo comunicar con el servicio de IA.';
}

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
export function extractJSON<T = any>(raw: unknown): T {
  const source = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
  let cleaned = source.trim();

  if (!cleaned) {
    throw new Error('La IA respondió con un contenido vacío.');
  }

  // Quitar bloques de pensamiento <think>...</think>
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Quitar markdown ```json ... ``` o ``` ... ```
  cleaned = cleaned
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!cleaned) {
    throw new Error('La IA respondió con contenido vacío tras limpiar la respuesta.');
  }

  const candidates = new Set<string>();
  candidates.add(cleaned);

  // Si hay ruido antes/después del JSON, intentar aislar el bloque principal
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
    candidates.add(cleaned.substring(firstBrace, lastBrace + 1));
  }

  // Fallback adicional: probar todos los rangos { ... } válidos del texto
  for (let start = cleaned.indexOf('{'); start !== -1; start = cleaned.indexOf('{', start + 1)) {
    for (let end = cleaned.lastIndexOf('}'); end > start; end = cleaned.lastIndexOf('}', end - 1)) {
      const candidate = cleaned.substring(start, end + 1).trim();
      if (candidate.length > 2) {
        candidates.add(candidate);
      }
      break;
    }
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Probar siguiente candidato, si existe uno mejor aislado
    }
  }

  throw new Error('La IA respondió con un formato JSON inválido o incompleto.');
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
  if (!key) {
    throw new Error('API key de Groq no configurada. Ve a Ajustes > Asistente IA.');
  }
  if (key.startsWith('AIza')) {
    throw new Error('Has configurado una clave de Gemini (AIza...) con Groq seleccionado. Selecciona Gemini en Ajustes o ingresa una clave de Groq (gsk_...).');
  }
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
                'Eres un asistente experto en productividad, cronobiología, hipertrofia calisténica y nutrición casera colombiana. Responde única y exclusivamente con un objeto JSON válido, sin explicaciones ni markdown.',
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
  if (!key) {
    throw new Error('API key de Gemini no configurada. Ve a Ajustes > Asistente IA.');
  }
  if (key.startsWith('gsk_')) {
    throw new Error('Has configurado una clave de Groq (gsk_...) con Gemini seleccionado. Selecciona Groq en Ajustes o ingresa una clave de Google AI Studio (AIza...).');
  }

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
      if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
        throw new Error('La clave API de Gemini no es válida o ha sido revocada por Google. Obtén una nueva clave en Google AI Studio (aistudio.google.com).');
      }
      if (msg.includes('429') || msg.includes('quota') || msg.includes('rate') || msg.includes('RESOURCE_EXHAUSTED')) {
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
  const split = dayOfWeek !== undefined ? getScheduledSplitForDayOfWeek(dayOfWeek) : 'pull';
  const splitInfo = WORKOUT_SPLITS[split];
  const workoutSlot = settings.workoutSlot ?? 'morning';
  const mealTimes = settings.mealTimes ?? {
    breakfast: '07:30',
    postWorkout: '10:30',
    senaLunch: '14:00',
    dinner: '20:00',
  };

  const lines: string[] = [
    '=== PERFIL CLÍNICO, POSTURAL Y METABÓLICO DEL USUARIO ===',
    `Estatura: ${CLINICAL_PROFILE.heightMeters} m | Peso actual: ${settings.currentWeightKg ?? CLINICAL_PROFILE.startingWeightKg} kg (IMC ~17.47) -> Meta: ${settings.targetWeightKg ?? 54} kg de masa muscular limpia`,
    `Meta nutricional: ~${CLINICAL_PROFILE.dailyCaloriesTarget} kcal/día y ${CLINICAL_PROFILE.dailyProteinMinG}-${CLINICAL_PROFILE.dailyProteinMaxG}g de proteína en 4 comidas + ${settings.waterGoalMl ?? 2500} ml de agua (corte de líquidos a las 20:30).`,
    `Condición biomecánica: Escoliosis leve + 6h diarias en PC. Regla 2:1 Tracción/Empuje. Micro-pausas posturales cada ${settings.postureReminderMinutes ?? 45} min.`,
    `Regla de entrenamiento: PROHIBIDO doble jornada. UNA SOLA sesión intensa de ${settings.exerciseDuration ?? 50} min al día (${splitInfo.title}).`,
    `Turno preferido de entrenamiento: ${workoutSlot === 'morning' ? 'MAÑANA (09:00 - 09:50)' : 'TARDE POST-SENA (18:45 - 19:35)'}`,
    `Cronobiología: Despertar ${settings.wakeTime} (1 alarma, luz solar + agua) | Luz cálida 21:00 | Desconexión pantallas 22:00 | Dormir ${settings.sleepTime} (de lado con almohada entre rodillas o boca arriba).`,
    `Bloques profundos: ${settings.dailyDeepBlocksMin}-${settings.dailyDeepBlocksMax} diarios, ${settings.deepBlockDuration} min c/u`,
    `Máx. redes sociales: ${settings.socialMediaMaxMinutes} min/día`,
    '',
    '=== ESTRUCTURA HORARIA DEL DÍA (OBLIGATORIO RESPETAR) ===',
    `Comidas obligatorias: 1) Desayuno (${mealTimes.breakfast}, mín. 3 huevos) | 2) Recarga Post-Entreno (${mealTimes.postWorkout}) | 3) Almuerzo en pausa del SENA (${mealTimes.senaLunch}) | 4) Cena completa (${mealTimes.dinner}, corte de agua 20:30).`,
  ];

  if (isWeekend) {
    lines.push(
      `Tipo de día: FIN DE SEMANA (${dayOfWeek === 6 ? 'sábado — Piernas y Core' : 'domingo — Descanso y Movilidad Postural'})`,
      `Todo el día es libre desde ${settings.wakeTime} hasta ${settings.sleepTime}.`,
      `Respeta las 4 comidas y la única sesión de ${splitInfo.shortTitle}.`
    );
  } else {
    lines.push(
      `Tipo de día: ENTRE SEMANA (lunes a viernes)`,
      `Horario SENA (formación): ${settings.scheduleStartTime} - ${settings.scheduleEndTime} (con salida de almuerzo a las ${mealTimes.senaLunch})`,
      `Hora de llegada a casa tras SENA: ${settings.arrivalTime}`,
      '',
      '⚠️ VENTANAS DE TIEMPO DISPONIBLES:',
      `  🌅 MAÑANA (${settings.wakeTime} - ${settings.scheduleStartTime}):`,
      workoutSlot === 'morning'
        ? `     → 07:00 Luz solar y agua, 07:30 Desayuno (3 huevos), 08:00 Estudio ligero, 09:00-09:50 Calistenia (${splitInfo.shortTitle}), 09:50 Ducha, 10:30 Recarga Post-Entreno Pre-SENA, 11:35 Transporte al SENA.`
        : `     → 07:00 Luz solar y agua, 07:30 Desayuno (3 huevos), 08:00-10:30 Bloques Profundos de Estudio, 10:30 Merienda Pre-SENA, 11:35 Transporte al SENA.`,
      `  🏫 FORMAL SENA (${settings.scheduleStartTime} - ${settings.scheduleEndTime}):`,
      `     → Bloqueado para formación SENA (incluye salida a las ${mealTimes.senaLunch} para Almuerzo).`,
      `  🚌 TRANSICIÓN (${settings.scheduleEndTime} - ${settings.arrivalTime}):`,
      `     → Transporte de regreso.`,
      `  🌙 TARDE/NOCHE (${settings.arrivalTime} - ${settings.sleepTime}):`,
      workoutSlot === 'morning'
        ? `     → Bloques Profundos de estudio (18:45-20:00 y 20:30-21:20), Cena completa a las 20:00 (corte de agua 20:30), Desconexión y protocolo postural de sueño 22:00-22:30.`
        : `     → Calistenia (${splitInfo.shortTitle}) de 18:45 a 19:35, Ducha, Cena completa a las 20:00 (corte de agua 20:30), Estudio ligero/Repaso 20:30-21:30, Desconexión y protocolo de sueño 22:00-22:30.`
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
  }

  if (recentMetrics.length > 0) {
    lines.push('', '=== MÉTRICAS RECIENTES ===');
    for (const m of recentMetrics.slice(-7)) {
      const extra = [
        m.energyLevel ? `energía ${m.energyLevel}/10` : '',
        m.weightKg ? `peso ${m.weightKg}kg` : '',
      ].filter(Boolean).join(', ');
      lines.push(`  ${m.date}: ${m.blocksCompleted}/${m.blocksPlanned} completados, ${m.deepWorkHours.toFixed(1)}h deep, score ${m.disciplineScore} ${extra}`);
    }
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
  const workoutSlot = settings.workoutSlot ?? 'morning';
  const split = getScheduledSplitForDayOfWeek(dayOfWeek);
  const splitInfo = WORKOUT_SPLITS[split];

  const prompt = `Eres un asistente clínico y de productividad experto. Genera un horario diario optimizado para el usuario respetando su protocolo de hipertrofia (47kg -> 54kg), escoliosis y horario del SENA.

${buildContextPrompt(settings, profile, recentMetrics, dayOfWeek)}

${buildTasksPrompt(tasks)}

${buildExistingBlocksPrompt(existingBlocks)}

=== INSTRUCCIONES ===
Genera un horario optimizado para: ${date} (${dayNames[dayOfWeek]})

REGLAS ESTRICTAS DE HORARIO (OBLIGATORIO):
- ❌ PROHIBIDO crear bloques que empiecen ANTES de ${settings.wakeTime} o terminen DESPUÉS de ${settings.sleepTime}
- ❌ PROHIBIDO hacer doble jornada de ejercicio: programa UNA SOLA sesión de "exercise" de ~50 min llamada "Calistenia: ${splitInfo.shortTitle}" (${workoutSlot === 'morning' ? 'en la mañana de 09:00 a 09:50' : 'en la tarde de 18:45 a 19:35'}).
${
  isWeekend
    ? `- ✅ Es fin de semana: todo el rango ${settings.wakeTime} - ${settings.sleepTime} está disponible libremente`
    : `- ❌ PROHIBIDO crear bloques de estudio o ejercicio entre ${settings.scheduleStartTime} y ${settings.scheduleEndTime} — el usuario está en el SENA
- ❌ PROHIBIDO crear bloques de estudio entre ${settings.scheduleEndTime} y ${settings.arrivalTime} — el usuario está en transporte
- ✅ Incluye Desayuno (07:30), Recarga Post-Entreno Pre-SENA (10:30), Cena completa + Corte de agua (20:00-20:30) y Desconexión + Protocolo de sueño (22:00-22:30).`
}

REGLAS GENERALES:
1. Cada bloque: type (deep|light|exercise|rest), label, startTime (HH:mm), endTime (HH:mm), priority (high|medium|low), taskId (string o null), reason (string)
2. ⚠️ ASIGNACIÓN ESTRICTA DE TAREAS:
   - Usa ÚNICAMENTE los IDs exactos de la lista "=== TAREAS PENDIENTES DEL USUARIO ===" para la propiedad "taskId".
   - Si asignas una tarea real, usa el nombre exacto de la materia como "label".
   - NUNCA inventes nombres de materias ni tareas ficticias.
   - Si un bloque de estudio no tiene tarea de la lista, coloca "taskId": null y nómbralo "Bloque Profundo 1", "Bloque Profundo 2", "Estudio Ligero" o "Repaso General".
3. Sin solapamientos entre bloques.
4. Comidas, transporte, SENA y desconexión nocturna → SIEMPRE tipo "rest", SIN taskId ("taskId": null).

Responde SOLO con JSON válido (sin markdown, sin backticks):
{
  "blocks": [{"type":"deep","label":"nombre","startTime":"HH:mm","endTime":"HH:mm","priority":"high","taskId":"id_real_o_null","reason":"razón"}],
  "insights": ["observación clínica y de productividad 1"],
  "confidence": 0.9
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

      if (start < wakeMin || end > sleepMin) {
        return false;
      }

      // Entre semana: si entrena en la mañana, los bloques deep van en la tarde/noche
      if (!isWeekend && workoutSlot === 'morning' && b.type === 'deep' && start < formalStartMin) {
        b.type = 'light';
      }

      // Entre semana: rechazar bloques de estudio/ejercicio durante horario formal
      if (!isWeekend && (b.type === 'deep' || b.type === 'exercise')) {
        if (start < formalEndMin && end > formalStartMin) {
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

      if (b.taskId && taskMap.has(b.taskId)) {
        assignedTasks.add(b.taskId);
        const legitimateTask = taskMap.get(b.taskId)!;
        b.label = legitimateTask.subject;
      } else {
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
    throw new Error(formatAIErrorMessage(error, provider));
  }
}

/**
 * Genera una adaptación nutricional inteligente para cualquiera de las 4 comidas del usuario
 * usando los ingredientes que realmente tiene hoy en su cocina (con fallback local instantáneo).
 */
export async function generateAIMealAdaptation(
  provider: AIProvider,
  apiKey: string | undefined,
  mealId: MealId,
  availableIngredients: string[],
  customText: string
): Promise<MealCustomOverride> {
  const mealDef = MEAL_PROTOCOL[mealId];
  const cleanKey = sanitizeApiKey(apiKey ?? '');

  // Si no hay API key configurada, usar el motor local instantáneo
  if (!cleanKey || cleanKey.length < 8) {
    return buildLocalMealSubstitution(mealId, availableIngredients, customText);
  }

  const ingredientsList = [
    ...availableIngredients,
    customText.trim() ? `Nota del usuario: "${customText.trim()}"` : '',
  ]
    .filter(Boolean)
    .join(', ');

  const prompt = `Eres el nutricionista deportivo de un joven colombiano de 1.64 m y 47 kg (IMC 17.47) que busca subir a 53-55 kg de masa muscular limpia (~2,400 kcal y 90-100g de proteína al día con presupuesto casero).

Comida a adaptar: ${mealDef.number}. ${mealDef.name} (${mealDef.defaultTime})
Meta de esta comida: ${mealDef.targetProtein} y ${mealDef.targetCalories}
Objetivo clínico: ${mealDef.clinicalGoal}
Regla de oro: ${mealDef.goldenRule}

Opciones originales del plan:
${mealDef.options.map((o) => `- ${o.label}: ${o.details}`).join('\n')}

El usuario NO tiene todos los ingredientes originales y nos dice qué tiene disponible en casa ahora mismo:
[${ingredientsList || 'Ingredientes básicos de casa colombiana'}]

Diseña UN plato o combinación casera exacta usando lo que tiene disponible (y si falta proteína para llegar a ~25-30g, dile exactamente cómo compensarlo doblando porciones de lo que sí tiene, ej. más granos+arroz, leche, queso, atún o huevos).

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin backticks):
{
  "title": "Nombre corto y apetitoso del plato con cantidades exactas (ej: 2 Huevos pericos + 1 taza de lentejas con arroz + 1 vaso de leche)",
  "description": "Explicación práctica de preparación y por qué cubre su meta de volumen limpio hoy",
  "macros": "~XXg proteína · ~XXX kcal"
}`;

  try {
    const raw = await generate(provider, cleanKey, prompt);
    const parsed = extractJSON<{ title: string; description: string; macros: string }>(raw);
    if (!parsed.title || !parsed.macros) {
      throw new Error('Respuesta incompleta');
    }
    return {
      title: parsed.title,
      description: parsed.description || mealDef.clinicalGoal,
      macros: parsed.macros,
      ingredientsUsed:
        availableIngredients.length > 0
          ? availableIngredients
          : [customText.trim() || 'Adaptado con IA'],
      generatedByAI: true,
    };
  } catch (err) {
    console.warn('[AI Meal Adaptation] Usando motor nutricional local de respaldo:', err);
    return buildLocalMealSubstitution(mealId, availableIngredients, customText);
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

  const prompt = `Eres el coach clínico, postural y de productividad del estudiante. Analiza su día.

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
{"analysis":"párrafo breve conectando estudio, energía, nutrición y postura","suggestions":["sug 1"],"productivityTips":["tip 1"]}`;

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
        try {
          const testMsg = await groqGenerate(key, 'ping');
          if (testMsg && testMsg.length > 0) return { valid: true };
        } catch {
          return {
            valid: false,
            error: 'Los servidores de Groq rechazaron la clave (401 Unauthorized). La clave es incorrecta, fue revocada o expiró. Genera una nueva en console.groq.com/keys',
          };
        }
      }

      const errData = await res.json().catch(() => null);
      const errMsg = errData?.error?.message || `Error de Groq (HTTP ${res.status})`;
      return { valid: false, error: errMsg };
    } catch {
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
    if (key.startsWith('gsk_')) {
      return {
        valid: false,
        error: 'Esta clave comienza con "gsk_", correspondiente a Groq. Selecciona Groq arriba.',
      };
    }
    try {
      const text = await geminiGenerate(key, 'ping');
      return { valid: text.length > 0 };
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('429') || msg.includes('quota') || msg.includes('rate') || msg.includes('RESOURCE_EXHAUSTED')) {
        return { valid: true };
      }
      return { valid: false, error: formatAIErrorMessage(err, 'gemini') };
    }
  }

  return { valid: false, error: 'No se pudo verificar la API key' };
}
