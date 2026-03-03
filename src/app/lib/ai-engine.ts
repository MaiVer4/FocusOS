/**
 * ─── AI Engine (Gemini) ──────────────────────────────────────────────────────
 *
 * Motor de IA que usa Google Gemini para:
 *  1. Analizar patrones de productividad del usuario
 *  2. Generar horarios optimizados basados en contexto real
 *  3. Priorizar y distribuir tareas de forma inteligente
 *  4. Dar recomendaciones personalizadas
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { Block, BlockType, Task, UserSettings, DailyMetrics } from './types';
import { LearnedProfile } from './learning-engine';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface AIGeneratedBlock {
  type: BlockType;
  label: string;
  startTime: string; // HH:mm
  endTime: string;
  priority: 'high' | 'medium' | 'low';
  taskId?: string;
  reason?: string; // Por qué la IA eligió esto
}

export interface AIScheduleResult {
  blocks: AIGeneratedBlock[];
  insights: string[];  // Observaciones de la IA
  confidence: number;  // 0–1 confianza en la recomendación
}

export interface AIDailySummary {
  analysis: string;
  suggestions: string[];
  productivityTips: string[];
}

// ─── Gemini Client ───────────────────────────────────────────────────────────

// Modelos en orden de preferencia (si uno falla por cuota, probar el siguiente)
const AI_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];

let genAI: GoogleGenerativeAI | null = null;

/** Elimina caracteres invisibles (zero-width spaces, BOM, etc.) de la API key */
export function sanitizeApiKey(key: string): string {
  // Eliminar todo lo que no sea ASCII imprimible
  return key.replace(/[^\x20-\x7E]/g, '').trim();
}

function getClient(apiKey: string): GoogleGenerativeAI {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(sanitizeApiKey(apiKey));
  }
  return genAI;
}

/** Resetea el cliente (cuando cambia la API key) */
export function resetAIClient(): void {
  genAI = null;
}

/**
 * Intenta generar contenido probando varios modelos.
 * Si uno falla por cuota (429), prueba el siguiente.
 */
async function generateWithFallback(client: GoogleGenerativeAI, prompt: string): Promise<string> {
  let lastError: any = null;
  for (const modelName of AI_MODELS) {
    try {
      const model = client.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err: any) {
      lastError = err;
      const msg = err?.message ?? '';
      // Si es error de cuota, probar siguiente modelo
      if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) {
        console.warn(`[AI Engine] Modelo ${modelName} sin cuota, probando siguiente...`);
        continue;
      }
      // Si es otro error (key inválida, etc.) no seguir probando
      throw err;
    }
  }
  throw lastError ?? new Error('Todos los modelos agotaron su cuota. Intenta más tarde.');
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

function buildContextPrompt(
  settings: UserSettings,
  profile: LearnedProfile | null,
  recentMetrics: DailyMetrics[],
): string {
  const lines: string[] = [
    '=== CONTEXTO DEL USUARIO ===',
    `Hora de despertar: ${settings.wakeTime}`,
    `Hora de dormir: ${settings.sleepTime}`,
    `Horario de actividades formales: ${settings.scheduleStartTime} - ${settings.scheduleEndTime}`,
    `Hora de llegada a casa: ${settings.arrivalTime}`,
    `Pico de energía: ${settings.peakEnergyTime}`,
    `Bloques profundos: ${settings.dailyDeepBlocksMin}-${settings.dailyDeepBlocksMax} diarios, ${settings.deepBlockDuration} min c/u`,
    `Ejercicio: ${settings.exerciseMandatory ? `obligatorio, ${settings.exerciseDuration} min` : 'opcional'}`,
    `Máx. redes sociales: ${settings.socialMediaMaxMinutes} min/día`,
  ];

  if (profile && profile.totalBlocksAnalyzed >= 5) {
    lines.push('');
    lines.push('=== PERFIL DE PRODUCTIVIDAD APRENDIDO ===');
    lines.push(`Bloques analizados: ${profile.totalBlocksAnalyzed}`);
    lines.push(`Duración óptima deep: ${profile.optimalDeepDuration} min`);
    lines.push(`Duración óptima light: ${profile.optimalLightDuration} min`);

    if (profile.bestDeepSlots.length > 0) {
      lines.push(`Mejores franjas para trabajo profundo: ${profile.bestDeepSlots.join(', ')}`);
    }
    if (profile.bestLightSlots.length > 0) {
      lines.push(`Mejores franjas para trabajo ligero: ${profile.bestLightSlots.join(', ')}`);
    }

    // Stats por tipo
    for (const type of ['deep', 'light', 'exercise'] as BlockType[]) {
      const ts = profile.typeStats[type];
      if (ts.total > 0) {
        lines.push(`  ${type}: ${ts.total} bloques, ${Math.round(ts.successRate * 100)}% éxito, promedio ${ts.avgDuration} min`);
      }
    }

    // Categorías
    const cats = Object.entries(profile.categoryStats);
    if (cats.length > 0) {
      lines.push('Rendimiento por categoría:');
      for (const [cat, cs] of cats) {
        lines.push(`  ${cat}: ${cs.total} bloques, ${Math.round(cs.successRate * 100)}% éxito`);
      }
    }
  }

  if (recentMetrics.length > 0) {
    lines.push('');
    lines.push('=== MÉTRICAS RECIENTES (últimos días) ===');
    for (const m of recentMetrics.slice(-7)) {
      lines.push(`  ${m.date}: ${m.blocksCompleted}/${m.blocksPlanned} completados, ${m.deepWorkHours.toFixed(1)}h deep work, score ${m.disciplineScore}`);
    }
  }

  return lines.join('\n');
}

function buildTasksPrompt(tasks: Task[]): string {
  if (tasks.length === 0) return 'No hay tareas pendientes.';

  const lines = ['=== TAREAS PENDIENTES ==='];
  for (const t of tasks) {
    const due = t.dueDate ? `entrega: ${t.dueDate.split('T')[0]}` : 'sin fecha';
    const cat = t.category ? `[${t.category}]` : '';
    const deliverable = t.isDeliverable ? '⚠️ ENTREGABLE' : '';
    const subtasksInfo = t.subtasks
      ? `(${t.subtasks.filter(s => s.done).length}/${t.subtasks.length} subtareas completadas)`
      : '';
    lines.push(`- ID:${t.id} | "${t.subject}" ${cat} | Dificultad: ${t.difficulty} | ${due} | Estado: ${t.status} ${deliverable} ${subtasksInfo}`);
    if (t.description) lines.push(`  Descripción: ${t.description}`);
  }
  return lines.join('\n');
}

function buildExistingBlocksPrompt(blocks: Block[]): string {
  if (blocks.length === 0) return 'No hay bloques previos hoy.';

  const lines = ['=== BLOQUES EXISTENTES HOY ==='];
  for (const b of blocks) {
    const task = b.task ? `→ tarea: "${b.task.subject}"` : '';
    lines.push(`  ${b.startTime}-${b.endTime} [${b.type}] ${b.label ?? ''} (${b.status}) ${task}`);
  }
  return lines.join('\n');
}

// ─── Funciones principales ───────────────────────────────────────────────────

/**
 * Genera un horario completo para un día usando IA.
 */
export async function generateAISchedule(
  apiKey: string,
  date: string,
  dayOfWeek: number,
  tasks: Task[],
  settings: UserSettings,
  profile: LearnedProfile | null,
  recentMetrics: DailyMetrics[],
  existingBlocks: Block[],
): Promise<AIScheduleResult> {
  const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const dayName = dayNames[dayOfWeek];

  const client = getClient(apiKey);

  const prompt = `Eres un asistente experto en productividad y gestión del tiempo. Tu trabajo es generar un horario diario optimizado para un estudiante.

${buildContextPrompt(settings, profile, recentMetrics)}

${buildTasksPrompt(tasks)}

${buildExistingBlocksPrompt(existingBlocks)}

=== INSTRUCCIONES ===
Genera un horario optimizado para el día: ${date} (${dayName})

Reglas:
1. Cada bloque debe tener: type (deep|light|exercise|rest), label, startTime (HH:mm), endTime (HH:mm), priority (high|medium|low)
2. Todo bloque que NO sea "rest" DEBE tener un taskId asignado de las tareas pendientes
3. Las tareas con deadline más cercano y dificultad más alta van en las franjas de MAYOR productividad del usuario
4. Incluir descansos entre bloques de trabajo (5-15 min)
5. Respetar el horario de despertar/dormir y las actividades formales
6. Incluir ejercicio si es obligatorio
7. No solapar horarios
8. Incluir bloques de descanso para comidas (desayuno, almuerzo/cena)
9. Considerar el perfil de productividad: colocar tareas difíciles en las franjas con mejor tasa de éxito
10. Las duraciones de bloques deep deben ser cercanas a la duración óptima aprendida
11. Si una tarea tiene subtareas parcialmente completadas, considerar el progreso

Responde SOLO con un JSON válido con esta estructura exacta (sin markdown, sin backticks):
{
  "blocks": [
    {
      "type": "deep",
      "label": "nombre descriptivo",
      "startTime": "HH:mm",
      "endTime": "HH:mm",
      "priority": "high",
      "taskId": "id-de-la-tarea",
      "reason": "razón breve de la asignación"
    }
  ],
  "insights": ["observación 1", "observación 2"],
  "confidence": 0.85
}`;

  try {
    const raw = await generateWithFallback(client, prompt);
    const text = raw.trim();

    // Limpiar posibles wrappers de markdown
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned) as AIScheduleResult;

    // Validar estructura básica
    if (!Array.isArray(parsed.blocks)) {
      throw new Error('Respuesta de IA no contiene bloques válidos');
    }

    // Validar y limpiar cada bloque
    parsed.blocks = parsed.blocks.filter(b =>
      b.type && b.startTime && b.endTime && b.label &&
      ['deep', 'light', 'exercise', 'rest'].includes(b.type) &&
      /^\d{2}:\d{2}$/.test(b.startTime) &&
      /^\d{2}:\d{2}$/.test(b.endTime)
    );

    // Validar que los taskIds existen
    const taskIds = new Set(tasks.map(t => t.id));
    for (const b of parsed.blocks) {
      if (b.taskId && !taskIds.has(b.taskId)) {
        b.taskId = undefined;
      }
    }

    parsed.confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

    parsed.insights = Array.isArray(parsed.insights) ? parsed.insights : [];

    return parsed;
  } catch (error: any) {
    console.error('Error generando horario con IA:', error);
    throw new Error(`Error de IA: ${error.message ?? 'No se pudo generar el horario'}`);
  }
}

/**
 * Pide a la IA un análisis/resumen del día con recomendaciones.
 */
export async function getAIDailySummary(
  apiKey: string,
  date: string,
  blocks: Block[],
  tasks: Task[],
  settings: UserSettings,
  profile: LearnedProfile | null,
  metrics: DailyMetrics[],
): Promise<AIDailySummary> {
  const client = getClient(apiKey);

  const completed = blocks.filter(b => b.status === 'completed');
  const failed = blocks.filter(b => b.status === 'failed');
  const pending = blocks.filter(b => b.status === 'pending');

  const prompt = `Eres un coach de productividad. Analiza el día del estudiante y da recomendaciones.

${buildContextPrompt(settings, profile, metrics)}

=== RESULTADOS DEL DÍA ${date} ===
Bloques completados: ${completed.length}
Bloques fallidos: ${failed.length}
Bloques pendientes: ${pending.length}

Detalle:
${blocks.map(b => {
  const task = b.task ? `→ "${b.task.subject}"` : '';
  return `  ${b.startTime}-${b.endTime} [${b.type}] ${b.label ?? ''} → ${b.status} (${b.interruptions} interrupciones) ${task}`;
}).join('\n')}

Tareas pendientes sin completar:
${tasks.filter(t => t.status !== 'terminada').map(t => `  - "${t.subject}" (${t.difficulty}, entrega: ${t.dueDate || 'sin fecha'})`).join('\n')}

Responde SOLO con JSON válido (sin markdown, sin backticks):
{
  "analysis": "párrafo breve analizando el día",
  "suggestions": ["sugerencia 1", "sugerencia 2"],
  "productivityTips": ["tip 1", "tip 2"]
}`;

  try {
    const raw = await generateWithFallback(client, prompt);
    const text = raw.trim();
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    return JSON.parse(cleaned) as AIDailySummary;
  } catch (error: any) {
    console.error('Error obteniendo resumen de IA:', error);
    return {
      analysis: 'No se pudo analizar el día.',
      suggestions: [],
      productivityTips: [],
    };
  }
}

/**
 * Valida que la API key funciona haciendo una petición simple.
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const client = new GoogleGenerativeAI(sanitizeApiKey(apiKey));
    const text = await generateWithFallback(client, 'Di hola');
    return text.length > 0;
  } catch (err: any) {
    const msg = err?.message ?? '';
    // Error 429 = la key ES válida, solo agotó cuota temporalmente
    if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) {
      console.warn('[AI Engine] Key válida pero cuota agotada en todos los modelos');
      return true; // Key válida, cuota temporal
    }
    console.error('[AI Engine] Error validando API key:', err);
    return false;
  }
}
