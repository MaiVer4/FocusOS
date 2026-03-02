import { dateToStr, todayStr } from './helpers';

export interface ParsedItem {
  subject: string;
  description: string;
  difficulty: 'high' | 'medium' | 'low';
  blockType: 'deep' | 'light' | 'exercise' | 'rest';
  estimatedMinutes: number;
  dueDate?: string; // YYYY-MM-DD o YYYY-MM-DDTHH:mm
  isDeliverable?: boolean;
}

// ─── System prompt para DeepSeek ────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un asistente de productividad. El usuario te dará una lista de tareas o actividades. Clasifica cada ítem y responde SOLO con un array JSON válido (sin markdown, sin texto extra, sin comentarios).

Para cada ítem devuelve un objeto con exactamente estas claves:
{
  "subject": "nombre limpio de la tarea, SIN la fecha ni hora de entrega (máx 60 caracteres)",
  "description": "descripción de 1 oración",
  "difficulty": "high" | "medium" | "low",
  "blockType": "deep" | "light" | "exercise" | "rest",
  "estimatedMinutes": número entero,
  "dueDate": "YYYY-MM-DDTHH:mm" o "YYYY-MM-DD" o null,
  "isDeliverable": true | false
}

REGLAS CRÍTICAS PARA subject:
- Elimina del subject cualquier mención de fecha, hora o plazo de entrega.
- Ejemplo: "Resolver ejercicios de JS capítulo 5 fecha de entrega: martes 3 de marzo a las 6 pm" → subject: "Resolver ejercicios de JS capítulo 5"
- Ejemplo: "Entregar informe de BD para el viernes" → subject: "Informe de BD"
- Ejemplo: "CRUD en Java para mañana a las 11:59 pm" → subject: "CRUD en Java"

REGLAS PARA dueDate:
- Usa la fecha de hoy que te proporcionaré para calcular fechas relativas ("hoy", "mañana", "este viernes", "el lunes", "martes 3 de marzo", etc.)
- Si el usuario dice un día de la semana sin especificar cuál, usa el PRÓXIMO día con ese nombre.
- Si incluye hora, usa formato "YYYY-MM-DDTHH:mm". Si no incluye hora, usa "YYYY-MM-DD".
- Interpreta "6 pm" como "18:00", "11:59 pm" como "23:59", "8 am" como "08:00", etc.

REGLAS PARA isDeliverable:
- true si el usuario menciona: "entrega", "entregar", "entregable", "fecha de entrega", "deadline", "fecha límite", "parcial", "examen", "quiz", "evaluación", "sustentación".
- true si tiene una fecha/hora de entrega explícita.
- false para tareas generales sin fecha límite clara.

Criterios de blockType:
- "deep": trabajo intelectual intenso (estudiar, programar, redactar, investigar, diseñar, resolver ejercicios)
- "light": tareas leves (revisar emails, llamadas, reuniones cortas, organizar, leer superficialmente)
- "exercise": actividad física (gym, correr, caminar, yoga, deporte, natación, bicicleta)
- "rest": descanso, meditación, siesta, pausa

Criterios de difficulty:
- "high": requiere mucho esfuerzo o concentración sostenida
- "medium": esfuerzo moderado
- "low": tarea simple, rutinaria o de bajo costo cognitivo`;

// ─── Keyword-based fallback ───────────────────────────────────────────────────

const DAY_NAMES: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3,
  jueves: 4, viernes: 5, sábado: 6, sabado: 6,
};

const MONTH_NAMES: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

/** Parse "6 pm" / "18:00" / "11:59 pm" → "HH:mm" */
function parseTime(text: string): string | undefined {
  // "6 pm", "6:30 pm", "11:59 am"
  const ampm = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = ampm[2] ? parseInt(ampm[2]) : 0;
    if (ampm[3].toLowerCase() === 'pm' && h !== 12) h += 12;
    if (ampm[3].toLowerCase() === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  // "18:00"
  const h24 = text.match(/(\d{1,2}):(\d{2})/);
  if (h24 && parseInt(h24[1]) < 24) {
    return `${String(parseInt(h24[1])).padStart(2, '0')}:${h24[2]}`;
  }
  return undefined;
}

/** Tries to extract a date (and optional time) from the text, returns {dueDate, cleanText} */
function extractDate(text: string): { dueDate?: string; cleanText: string } {
  const lower = text.toLowerCase();
  const today = new Date();
  let dueDate: string | undefined;
  let cleanText = text;

  // Remove common date prefixes for cleaning
  const datePatterns = [
    /\s*(?:fecha\s+de\s+entrega|entrega|deadline|fecha\s+l[ií]mite)\s*:?\s*/gi,
    /\s*para\s+(?:el\s+)?/gi,
  ];

  // Try "martes 3 de marzo", "3 de marzo", etc.
  const spanishDate = lower.match(
    /(?:(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+(?:de\s+)?(\d{4}))?/
  );
  if (spanishDate) {
    const day = parseInt(spanishDate[2]);
    const month = MONTH_NAMES[spanishDate[3]];
    const year = spanishDate[4] ? parseInt(spanishDate[4]) : today.getFullYear();
    const d = new Date(year, month, day);
    if (d < today && !spanishDate[4]) d.setFullYear(d.getFullYear() + 1);
    dueDate = dateToStr(d);
    // Remove the matched date from text
    cleanText = cleanText.replace(new RegExp(spanishDate[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '');
  }

  // Try day names: "el lunes", "para el viernes"
  if (!dueDate) {
    for (const [name, dow] of Object.entries(DAY_NAMES)) {
      if (lower.includes(name)) {
        const d = new Date(today);
        const diff = (dow - d.getDay() + 7) % 7 || 7;
        d.setDate(d.getDate() + diff);
        dueDate = dateToStr(d);
        cleanText = cleanText.replace(new RegExp(name, 'gi'), '');
        break;
      }
    }
  }

  // "hoy" / "mañana"
  if (!dueDate && lower.includes('hoy')) {
    dueDate = todayStr();
    cleanText = cleanText.replace(/hoy/gi, '');
  } else if (!dueDate && lower.includes('mañana')) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    dueDate = dateToStr(d);
    cleanText = cleanText.replace(/mañana/gi, '');
  }

  // Try to extract time
  const time = parseTime(lower);
  if (dueDate && time) {
    dueDate = `${dueDate}T${time}`;
    // Remove time from cleanText
    cleanText = cleanText.replace(/\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)/g, '');
    cleanText = cleanText.replace(/a\s+las?\s*/gi, '');
  }

  // Clean remaining date phrasing
  for (const p of datePatterns) {
    cleanText = cleanText.replace(p, ' ');
  }
  cleanText = cleanText.replace(/\s{2,}/g, ' ').trim();
  // Remove trailing prepositions/articles
  cleanText = cleanText.replace(/\s+(del?|para|el|la|a)\s*$/i, '').trim();

  return { dueDate, cleanText };
}

function classifyByKeywords(text: string): ParsedItem {
  const lower = text.toLowerCase();

  const deliverableKw = ['entrega', 'entregar', 'entregable', 'deadline', 'fecha límite',
    'fecha limite', 'parcial', 'examen', 'quiz', 'evaluación', 'evaluacion', 'sustentación', 'sustentacion'];
  const isDeliverable = deliverableKw.some(k => lower.includes(k))
    || /fecha\s+de\s+entrega/i.test(lower);

  const { dueDate, cleanText } = extractDate(text);

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

  if (isDeliverable && difficulty !== 'high') difficulty = 'high';

  return {
    subject: cleanText || text.trim(),
    description: '',
    difficulty,
    blockType,
    estimatedMinutes,
    dueDate,
    isDeliverable,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function classifyTasksWithAI(rawText: string): Promise<ParsedItem[]> {
  const lines = rawText
    .split('\n')
    .map(l => l.replace(/^[\s\-•*\d.]+/, '').trim())
    .filter(l => l.length > 2);

  if (lines.length === 0) return [];

  const apiKey = 'sk-a43ba1ed85624702a4a74a370331be9d';

  const today = new Date().toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Hoy es ${today}.\n\nTareas:\n${lines.join('\n')}` },
        ],
        temperature: 0.2,
      }),
    });

    if (!res.ok) throw new Error(`DeepSeek ${res.status}`);

    const data = await res.json();
    const content = (data.choices[0].message.content as string)
      .trim()
      .replace(/^```json\n?/, '')
      .replace(/^```\n?/, '')
      .replace(/\n?```$/, '');

    const parsed = JSON.parse(content) as ParsedItem[];
    return parsed;
  } catch (err) {
    console.error('DeepSeek classification failed, using keyword fallback:', err);
    return lines.map(classifyByKeywords);
  }
}
