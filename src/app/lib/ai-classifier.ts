import { store } from './store';
import { todayStr } from './helpers';

export interface ParsedItem {
  subject: string;
  description: string;
  difficulty: 'high' | 'medium' | 'low';
  blockType: 'deep' | 'light' | 'exercise' | 'rest';
  estimatedMinutes: number;
  dueDate?: string; // YYYY-MM-DD
}

// ─── System prompt for OpenAI ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un asistente de productividad. El usuario te dará una lista de tareas o actividades. Clasifica cada ítem y responde SOLO con un array JSON válido (sin markdown, sin texto extra, sin comentarios).

Para cada ítem devuelve un objeto con exactamente estas claves:
{
  "subject": "nombre corto de la tarea (máx 60 caracteres)",
  "description": "descripción de 1 oración",
  "difficulty": "high" | "medium" | "low",
  "blockType": "deep" | "light" | "exercise" | "rest",
  "estimatedMinutes": número entero,
  "dueDate": "YYYY-MM-DD" o null
}

Criterios de blockType:
- "deep": trabajo intelectual intenso (estudiar, programar, redactar, investigar, diseñar, resolver ejercicios)
- "light": tareas leves (revisar emails, llamadas, reuniones cortas, organizar, leer superficialmente)
- "exercise": actividad física (gym, correr, caminar, yoga, deporte, natación, bicicleta)
- "rest": descanso, meditación, siesta, pausa

Criterios de difficulty:
- "high": requiere mucho esfuerzo o concentración sostenida
- "medium": esfuerzo moderado
- "low": tarea simple, rutinaria o de bajo costo cognitivo

Interpreta menciones de tiempo relativo ("hoy", "mañana", "esta semana") en el dueDate.`;

// ─── Keyword-based fallback ───────────────────────────────────────────────────

function classifyByKeywords(text: string): ParsedItem {
  const lower = text.toLowerCase();

  const exerciseKw = ['ejercicio', 'gym', 'correr', 'caminar', 'entrenar', 'yoga',
    'deporte', 'natación', 'bicicleta', 'pesas', 'cardio', 'trotar', 'pilates'];
  const restKw = ['descanso', 'dormir', 'siesta', 'meditar', 'meditación',
    'relajar', 'pausa', 'break', 'descansar'];
  const lightKw = ['email', 'correo', 'reunión', 'llamada', 'revisar', 'leer',
    'organizar', 'planificar', 'whatsapp', 'mensaje', 'zoom', 'meet', 'responder'];
  const deepKw = ['examen', 'parcial', 'proyecto', 'tesis', 'informe', 'investigar',
    'programar', 'código', 'diseñar', 'calcular', 'redactar', 'estudiar', 'resolver',
    'analizar', 'desarrollar'];

  let blockType: ParsedItem['blockType'] = 'deep';
  let difficulty: ParsedItem['difficulty'] = 'medium';
  let estimatedMinutes = 60;

  if (exerciseKw.some(k => lower.includes(k))) {
    blockType = 'exercise'; difficulty = 'low'; estimatedMinutes = 45;
  } else if (restKw.some(k => lower.includes(k))) {
    blockType = 'rest'; difficulty = 'low'; estimatedMinutes = 20;
  } else if (lightKw.some(k => lower.includes(k))) {
    blockType = 'light'; difficulty = 'low'; estimatedMinutes = 30;
  } else if (deepKw.some(k => lower.includes(k))) {
    blockType = 'deep'; difficulty = 'high'; estimatedMinutes = 90;
  }

  const today = new Date();
  let dueDate: string | undefined;
  if (lower.includes('hoy')) {
    dueDate = todayStr();
  } else if (lower.includes('mañana')) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    dueDate = tomorrow.toISOString().split('T')[0];
  }

  return { subject: text.trim(), description: '', difficulty, blockType, estimatedMinutes, dueDate };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function classifyTasksWithAI(rawText: string): Promise<ParsedItem[]> {
  const lines = rawText
    .split('\n')
    .map(l => l.replace(/^[\s\-•*\d.]+/, '').trim())
    .filter(l => l.length > 2);

  if (lines.length === 0) return [];

  const apiKey = store.getSettings().openaiApiKey;

  if (!apiKey) {
    return lines.map(classifyByKeywords);
  }

  const today = new Date().toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Hoy es ${today}.\n\nTareas:\n${lines.join('\n')}` },
        ],
        temperature: 0.2,
      }),
    });

    if (!res.ok) throw new Error(`OpenAI ${res.status}`);

    const data = await res.json();
    const content = (data.choices[0].message.content as string)
      .trim()
      .replace(/^```json\n?/, '')
      .replace(/^```\n?/, '')
      .replace(/\n?```$/, '');

    const parsed = JSON.parse(content) as ParsedItem[];
    return parsed;
  } catch (err) {
    console.error('AI classification failed, using keyword fallback:', err);
    return lines.map(classifyByKeywords);
  }
}
