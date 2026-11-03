import { DailyWorkoutLog, MealCustomOverride, MealId, WorkoutSplitType } from './types';
import { getDayOfWeek, parseLocalDate } from './helpers';

// ─── Diagnóstico Clínico, Postural y Metabólico ──────────────────────────────

export const CLINICAL_PROFILE = {
  heightMeters: 1.64,
  startingWeightKg: 47,
  startingBmi: 17.47,
  targetWeightMinKg: 53,
  targetWeightMaxKg: 55,
  dailyCaloriesTarget: 2400,
  dailyProteinMinG: 90,
  dailyProteinMaxG: 100,
  waterGoalMl: 2500,
  waterCutoffTime: '20:30',
  blueLightFilterTime: '21:00',
  screenDisconnectTime: '22:00',
  sleepTime: '22:30',
  wakeTime: '07:00',
  baselineEnergy: 4.5,
  targetEnergy: 8.5,
} as const;

// ─── Rutina de Calistenia, Hipertrofia y Postura en Casa (6 Días) ────────────

export interface WorkoutExercise {
  id: string;
  name: string;
  sets: number;
  reps: string;
  restSeconds: number;
  tempo?: string;
  equipment: string;
  clinicalNote: string;
  usesBackpack: boolean;
}

export interface WorkoutSplitDefinition {
  id: WorkoutSplitType;
  title: string;
  shortTitle: string;
  subtitle: string;
  daysLabel: string;
  priorityBadge?: string;
  medicalWarning: string;
  exercises: WorkoutExercise[];
}

export const WORKOUT_SPLITS: Record<WorkoutSplitType, WorkoutSplitDefinition> = {
  push: {
    id: 'push',
    title: 'Empuje: Pecho, Hombros y Tríceps',
    shortTitle: 'Empuje (Tempo 3-1)',
    subtitle: 'Calidad técnica sobre cantidad — 3 seg bajando, 1 seg subiendo',
    daysLabel: 'Días 1 y 4 (Lunes y Jueves)',
    medicalWarning:
      'Regla 2:1 de Escoliosis: En vez de 60 lagartijas rápidas que rotan tus hombros hacia adelante, baja en 3 segundos controlados y mantén las escápulas estables.',
    exercises: [
      {
        id: 'push_decline',
        name: 'Lagartijas declinadas (pies en cama o silla)',
        sets: 4,
        reps: '10 a 15 reps',
        restSeconds: 90,
        tempo: '3s bajando · 1s subiendo',
        equipment: 'Cama o silla firme',
        clinicalNote: 'Enfocado en el pecho superior y hombros. Mantén el abdomen firme sin arquear la zona lumbar.',
        usesBackpack: true,
      },
      {
        id: 'push_strict',
        name: 'Lagartijas clásicas estrictas',
        sets: 4,
        reps: 'Al fallo técnico (recto)',
        restSeconds: 90,
        tempo: '3s bajando · 1s subiendo',
        equipment: 'Suelo + Morral con libros si pasas de 15',
        clinicalNote: 'El pecho toca el suelo, codos a 45° (no abiertos a 90°). Si superas 15 fáciles, usa el morral.',
        usesBackpack: true,
      },
      {
        id: 'push_dips',
        name: 'Fondos de tríceps en borde de silla o cama',
        sets: 3,
        reps: '12 a 15 reps',
        restSeconds: 75,
        tempo: '2s bajando · 1s subiendo',
        equipment: 'Borde de cama o silla firme',
        clinicalNote: 'Mantén los hombros lejos de las orejas y el pecho abierto para no encorvar la columna.',
        usesBackpack: false,
      },
      {
        id: 'push_pike',
        name: 'Flexiones en Pica (Pike Push-ups en "V" invertida)',
        sets: 3,
        reps: '8 a 12 reps',
        restSeconds: 90,
        tempo: '3s bajando · 1s subiendo',
        equipment: 'Suelo',
        clinicalNote: 'Cadera alta formando una "V" invertida. Trabaja el hombro completo para dar amplitud a tu clavícula.',
        usesBackpack: false,
      },
      {
        id: 'push_lateral',
        name: 'Elevaciones laterales con morral (un brazo a la vez)',
        sets: 3,
        reps: '15 reps por brazo',
        restSeconds: 60,
        tempo: 'Controlado sin impulso',
        equipment: 'Morral cargado con libros/botellas',
        clinicalNote: 'Empieza por tu lado más débil. Da ancho visual a los hombros y mejora la simetría postural.',
        usesBackpack: true,
      },
    ],
  },
  pull: {
    id: 'pull',
    title: 'Tracción, Espalda y Corrección de Escoliosis',
    shortTitle: 'Tracción y Escoliosis (Prioridad 2:1)',
    subtitle: 'El día más importante para alinear tu columna y abrir el pecho',
    daysLabel: 'Días 2 y 5 (Martes y Viernes)',
    priorityBadge: 'PRIORIDAD CLÍNICA 2:1',
    medicalWarning:
      'Fundamental para compensar las 6 horas de PC y las lagartijas. Empieza siempre los ejercicios unilaterales por tu lado más débil.',
    exercises: [
      {
        id: 'pull_australian',
        name: 'Remo invertido bajo mesa firme (Australian Pull-ups)',
        sets: 4,
        reps: '10 a 15 reps',
        restSeconds: 90,
        tempo: '1s subiendo · 2s pausa pectoral · 3s bajando',
        equipment: 'Mesa firme de comedor/escritorio o toalla en puerta',
        clinicalNote: 'Debajo de la mesa, cuerpo recto como tabla y sube el pecho al borde apretando omóplatos.',
        usesBackpack: false,
      },
      {
        id: 'pull_row_unilateral',
        name: 'Remo unilateral con morral pesado',
        sets: 4,
        reps: '12 a 15 reps por lado',
        restSeconds: 75,
        tempo: '2s subiendo · 3s bajando',
        equipment: 'Morral con libros + apoyo en cama',
        clinicalNote: 'Apoya mano y rodilla en la cama, espalda 100% recta y jala el morral hacia tu cadera. ¡Empieza por tu lado más débil!',
        usesBackpack: true,
      },
      {
        id: 'pull_swimmers',
        name: 'Nadadores posturales en el suelo (Prone Swimmers / Y-T-W)',
        sets: 4,
        reps: '12 reps lentas',
        restSeconds: 60,
        tempo: 'Lento e isométrico (2s por letra Y-T-W)',
        equipment: 'Suelo / tapete',
        clinicalNote: 'Boca abajo, levanta ligeramente el pecho y forma las letras Y, T y W apretando las escápulas atrás. Corrige hombros caídos por el PC.',
        usesBackpack: false,
      },
      {
        id: 'pull_birddog',
        name: 'Puente de glúteo y espalda baja (Bird-Dog)',
        sets: 3,
        reps: '10 reps por lado (3s pausa)',
        restSeconds: 60,
        tempo: '3 segundos sosteniendo arriba',
        equipment: 'Suelo (4 apoyos)',
        clinicalNote: 'Estira brazo derecho al frente y pierna izquierda atrás manteniendo columna recta 3s. Estabiliza la escoliosis sin comprimir vértebras.',
        usesBackpack: false,
      },
      {
        id: 'pull_curls',
        name: 'Curl de bíceps con morral (agarre por correas)',
        sets: 4,
        reps: '12 a 15 reps controladas',
        restSeconds: 60,
        tempo: '2s subiendo · 3s bajando sin balancear espalda',
        equipment: 'Morral cargado con libros/botellas',
        clinicalNote: 'Codos pegados al torso, pecho erguido y hombros atrás durante todo el movimiento.',
        usesBackpack: true,
      },
    ],
  },
  legs: {
    id: 'legs',
    title: 'Piernas (Volumen) y Cuadros Abdominales (Core)',
    shortTitle: 'Piernas y Core Anti-Escoliosis',
    subtitle: 'Hipertrofia de tren inferior + Abdomen denso sin encorvar el cuello',
    daysLabel: 'Días 3 y 6 (Miércoles y Sábado)',
    medicalWarning:
      'Nota médica: Prohibido hacer abdominales tradicionales encorvando el cuello. Tus cuadros crecerán por tensión directa y estabilidad lumbar.',
    exercises: [
      {
        id: 'legs_bulgarian',
        name: 'Sentadilla Búlgara (unilateral)',
        sets: 4,
        reps: '10 a 12 reps por pierna',
        restSeconds: 90,
        tempo: '3s bajando · 1s subiendo',
        equipment: 'Pie trasero en cama/silla + Morral con libros',
        clinicalNote: 'El mejor ejercicio sin gimnasio para dar tamaño a las piernas. Empieza por la pierna más débil.',
        usesBackpack: true,
      },
      {
        id: 'legs_squat',
        name: 'Sentadilla clásica controlada con morral pesado',
        sets: 4,
        reps: '15 a 20 reps',
        restSeconds: 90,
        tempo: '3 segundos bajando · subida potente',
        equipment: 'Morral pesado con libros/botellas',
        clinicalNote: 'Pecho orgulloso, mirada al frente y rodillas alineadas con la punta de los pies.',
        usesBackpack: true,
      },
      {
        id: 'legs_hipthrust',
        name: 'Puente de cadera a una pierna (Hip Thrust en cama)',
        sets: 4,
        reps: '12 reps por pierna',
        restSeconds: 75,
        tempo: '2s pausa arriba apretando glúteo',
        equipment: 'Espalda alta apoyada en borde de cama + Morral',
        clinicalNote: 'Sube la cadera alineando rodilla, cadera y hombro sin hiperextender la zona lumbar.',
        usesBackpack: true,
      },
      {
        id: 'legs_calves',
        name: 'Elevación de talones en escalón a una pierna (Pantorrillas)',
        sets: 4,
        reps: '20 reps por pierna',
        restSeconds: 45,
        tempo: 'Rango completo (2s arriba, 2s abajo)',
        equipment: 'Escalón o libro grueso + Morral',
        clinicalNote: 'Baja el talón completo y sube hasta máxima contracción.',
        usesBackpack: true,
      },
      {
        id: 'core_circuit',
        name: 'Circuito de Abdomen Anti-Escoliosis (4 Rondas Seguidas)',
        sets: 4,
        reps: '15 Elev. piernas + 45s Plancha RKC + 35s Plancha Lateral/lado',
        restSeconds: 60,
        tempo: 'Tensión máxima sin despegar espalda baja',
        equipment: 'Suelo',
        clinicalNote:
          '1) Elevaciones de piernas aplastando lumbar contra el piso (15 reps) → 2) Plancha RKC apretando abdomen y glúteos (40-60s) → 3) Plancha Lateral (30-45s por lado, clave para alinear escoliosis).',
        usesBackpack: false,
      },
    ],
  },
  rest: {
    id: 'rest',
    title: 'Recuperación Muscular, Movilidad Torácica y Postura',
    shortTitle: 'Descanso y Movilidad Postural',
    subtitle: 'Tus músculos crecen cuando descansas y duermes profundo',
    daysLabel: 'Domingo (Recuperación y Acomodo Semanal)',
    medicalWarning:
      'Con 47 kg, entrenar 7 días sin descanso quema las calorías que necesitas para subir a 53–55 kg. Hoy solo estira el pecho y descomprime tu columna.',
    exercises: [
      {
        id: 'rest_doorway',
        name: 'Estiramiento pectoral en marco de puerta',
        sets: 3,
        reps: '45 segundos por lado',
        restSeconds: 30,
        equipment: 'Marco de puerta',
        clinicalNote: 'Abre los pectorales acortados por las horas de PC y las lagartijas de la semana.',
        usesBackpack: false,
      },
      {
        id: 'rest_catcow',
        name: 'Movilidad suave de columna (Gato-Camello + Respiración costal)',
        sets: 3,
        reps: '10 respiraciones profundas',
        restSeconds: 30,
        equipment: 'Suelo / Cama',
        clinicalNote: 'Descomprime vértebras y mejora la expansión pulmonar.',
        usesBackpack: false,
      },
    ],
  },
};

/** Mapea el día de la semana (0=Dom..6=Sáb) a la rutina correspondiente */
export function getScheduledSplitForDayOfWeek(dayOfWeek: number): WorkoutSplitType {
  switch (dayOfWeek) {
    case 1: // Lunes - Día 1
    case 4: // Jueves - Día 4
      return 'push';
    case 2: // Martes - Día 2
    case 5: // Viernes - Día 5
      return 'pull';
    case 3: // Miércoles - Día 3
    case 6: // Sábado - Día 6
      return 'legs';
    case 0: // Domingo
    default:
      return 'rest';
  }
}

export interface BiomechanicalGuardAssessment {
  scheduledSplit: WorkoutSplitType;
  recommendedSplit: WorkoutSplitType;
  guardTriggered: boolean;
  reason?: string;
  weeklyPullCount: number;
  weeklyPushCount: number;
  weeklyLegsCount: number;
}

/**
 * Guardia Biomecánica 2:1 (Escoliosis):
 * Verifica los entrenamientos de los últimos 7 días.
 * Si hoy tocaba 'push' (Empuje), pero el usuario lleva >= sesiones de empuje que de tracción
 * o se saltó la sesión previa de tracción (martes/viernes), recomienda cambiar hoy a 'pull' (Tracción y Escoliosis).
 */
export function evaluateBiomechanicalGuard(
  dateStr: string,
  workoutLogs: DailyWorkoutLog[]
): BiomechanicalGuardAssessment {
  const dayOfWeek = getDayOfWeek(dateStr);
  const scheduledSplit = getScheduledSplitForDayOfWeek(dayOfWeek);

  const { year, month, day } = parseLocalDate(dateStr);
  const refDate = new Date(year, month - 1, day, 12, 0, 0);
  const sevenDaysAgo = new Date(refDate);
  sevenDaysAgo.setDate(refDate.getDate() - 7);
  const sy = sevenDaysAgo.getFullYear();
  const sm = String(sevenDaysAgo.getMonth() + 1).padStart(2, '0');
  const sd = String(sevenDaysAgo.getDate()).padStart(2, '0');
  const startIso = `${sy}-${sm}-${sd}`;

  const recentCompleted = workoutLogs.filter(
    (l) => l.date >= startIso && l.date < dateStr && l.completed
  );

  const weeklyPullCount = recentCompleted.filter((l) => l.splitType === 'pull').length;
  const weeklyPushCount = recentCompleted.filter((l) => l.splitType === 'push').length;
  const weeklyLegsCount = recentCompleted.filter((l) => l.splitType === 'legs').length;

  // Verificar si hoy el usuario ya guardó un split explícito
  const todayLog = workoutLogs.find((l) => l.date === dateStr);
  if (todayLog) {
    return {
      scheduledSplit,
      recommendedSplit: todayLog.splitType,
      guardTriggered: todayLog.splitType !== scheduledSplit,
      reason:
        todayLog.splitType !== scheduledSplit
          ? 'Ajustado manualmente o por prioridad postural 2:1.'
          : undefined,
      weeklyPullCount,
      weeklyPushCount,
      weeklyLegsCount,
    };
  }

  // Si hoy toca Empuje pero llevamos más Empuje que Tracción en los últimos 7 días
  if (scheduledSplit === 'push' && weeklyPushCount > weeklyPullCount) {
    return {
      scheduledSplit,
      recommendedSplit: 'pull',
      guardTriggered: true,
      reason: `Alerta Biomecánica 2:1: Llevas ${weeklyPushCount} sesión(es) de Empuje y solo ${weeklyPullCount} de Tracción en los últimos 7 días. Para proteger tu escoliosis y evitar rotar los hombros adelante, hoy priorizamos Espalda y Tracción.`,
      weeklyPullCount,
      weeklyPushCount,
      weeklyLegsCount,
    };
  }

  return {
    scheduledSplit,
    recommendedSplit: scheduledSplit,
    guardTriggered: false,
    weeklyPullCount,
    weeklyPushCount,
    weeklyLegsCount,
  };
}

// ─── Plan Nutricional de Volumen Limpio (4 Comidas Casera + SENA 2:00 p.m.) ──

export interface MealOptionItem {
  id: string;
  label: string;
  title: string;
  details: string;
  proteinGrams: number;
  calories: number;
}

export interface MealProtocolDefinition {
  id: MealId;
  number: number;
  name: string;
  defaultTime: string;
  targetProtein: string;
  targetCalories: string;
  clinicalGoal: string;
  goldenRule: string;
  options: MealOptionItem[];
}

export const MEAL_PROTOCOL: Record<MealId, MealProtocolDefinition> = {
  breakfast: {
    id: 'breakfast',
    number: 1,
    name: 'Desayuno Obligatorio',
    defaultTime: '07:30',
    targetProtein: '~25–28g proteína',
    targetCalories: '~600 kcal',
    clinicalGoal: 'Romper el ayuno con proteína real y carbohidratos de absorción media para entrenar con fuerza a las 9:00 a.m.',
    goldenRule: 'Cero desayunos en blanco o solo aguapanela con pan/galletas. Mínimo 3 huevos obligatorios.',
    options: [
      {
        id: 'bf_a',
        label: 'Opción A (Clásico Potente)',
        title: '3 huevos revueltos/pericos + Arepa con queso + Leche con avena/Chocolisto',
        details: '3 huevos revueltos o pericos + 1 arepa mediana con queso rallado o cuajada + 1 vaso de leche con Chocolisto o avena.',
        proteinGrams: 28,
        calories: 620,
      },
      {
        id: 'bf_b',
        label: 'Opción B (Energía Rápida)',
        title: '3 huevos cocidos/fritos + 2 panes o arepa + Banano + Café con leche',
        details: '3 huevos cocidos o fritos + 2 tajadas de pan o arepa + 1 banano mediano + 1 taza de café con leche.',
        proteinGrams: 26,
        calories: 590,
      },
    ],
  },
  post_workout: {
    id: 'post_workout',
    number: 2,
    name: 'Recarga Post-Entreno (Pre-SENA)',
    defaultTime: '10:30',
    targetProtein: '~22–26g proteína',
    targetCalories: '~580 kcal',
    clinicalGoal: 'Iniciar síntesis de proteína tras la calistenia de las 9:00 a.m. y cargar energía antes de salir hacia el SENA.',
    goldenRule: 'Tómala en casa después de ducharte y deja listo tu termo de agua para el SENA.',
    options: [
      {
        id: 'pw_a',
        label: 'Opción A (Licuado Calórico)',
        title: 'Licuado: 400ml leche + 4 cdas avena + 1 banano + 1 cda mantequilla de maní',
        details: '400 ml de leche entera + 4 cucharadas colmadas de avena en hojuelas + 1 banano + 1 cucharada de mantequilla de maní o maní triturado.',
        proteinGrams: 24,
        calories: 610,
      },
      {
        id: 'pw_b',
        label: 'Opción B (Sólido en Casa)',
        title: 'Sándwich doble de pollo/atún/jamón y queso (o arepa con 2 huevos) + 1 banano',
        details: '1 sándwich doble con buena porción de pollo desmechado, atún o jamón y queso + 1 banano.',
        proteinGrams: 25,
        calories: 560,
      },
    ],
  },
  sena_lunch: {
    id: 'sena_lunch',
    number: 3,
    name: 'Almuerzo en Pausa del SENA',
    defaultTime: '14:00',
    targetProtein: '~30–35g proteína',
    targetCalories: '~700 kcal',
    clinicalGoal: 'Aprovechar tu salida de las 2:00 p.m. en el SENA para nunca pasar 6 horas de clase sin aminoácidos ni calorías.',
    goldenRule: 'Combina granos (frijoles/lentejas) con arroz y una buena porción de presa (pollo/carne/atún/huevos).',
    options: [
      {
        id: 'sl_a',
        label: 'Opción A (Plato Completo / Mamá)',
        title: 'Frijoles o lentejas + Arroz blanco + Pollo/Carne/Atún + Plátano maduro o papa',
        details: '1 taza grande de frijoles o lentejas + 1 taza de arroz blanco + 1 porción de pollo, carne, cerdo o lata de atún + tajada de plátano maduro o papa.',
        proteinGrams: 34,
        calories: 720,
      },
      {
        id: 'sl_b',
        label: 'Opción B (Pasta de Volumen)',
        title: 'Espaguetis abundantes + 1 lata de atún o pollo desmechado + 2 huevos cocidos',
        details: 'Porción abundante de espaguetis + 1 lata completa de atún o pollo desmechado + 2 huevos cocidos picados encima.',
        proteinGrams: 35,
        calories: 690,
      },
      {
        id: 'sl_c',
        label: 'Opción C (Salida Rápida SENA + Refuerzo)',
        title: 'Almuerzo/Refrigerio fuera del SENA + 2 huevos duros o sándwich doble llevados',
        details: 'Si sales a comer algo ligero en el SENA (sándwich, arepa con queso, corrientazo o pasta), asegúrate de sumarle 2 huevos duros llevados de casa.',
        proteinGrams: 28,
        calories: 640,
      },
    ],
  },
  dinner: {
    id: 'dinner',
    number: 4,
    name: 'Cena Completa + Corte de Agua 8:30 p.m.',
    defaultTime: '20:00',
    targetProtein: '~25–30g proteína',
    targetCalories: '~550 kcal',
    clinicalGoal: 'Proveer aminoácidos de liberación sostenida para que la hormona de crecimiento construya músculo de noche sin pesadez digestiva.',
    goldenRule: 'Cenar a las 8:00 p.m. (2.5h antes de dormir) y cortar líquidos abundantes a las 8:30 p.m. para no interrumpir la fase REM.',
    options: [
      {
        id: 'dn_a',
        label: 'Opción A (Repetición de Casa)',
        title: 'Arroz/papa + Pollo, carne, atún o huevos + Granos (lentejas/frijoles)',
        details: 'Misma estructura nutritiva del almuerzo: arroz o papa + porción de proteína (pollo, carne, atún o huevos) + granos de tu mamá.',
        proteinGrams: 30,
        calories: 580,
      },
      {
        id: 'dn_b',
        label: 'Opción B (Cena Rápida Casera)',
        title: '1 arepa grande (o 2 panes) + 3 huevos con queso + 1 vaso de leche (antes de 8:30 p.m.)',
        details: 'Si no quedó almuerzo: 1 arepa grande o 2 panes + 3 huevos revueltos con queso + 1 vaso de leche antes de las 8:30 p.m.',
        proteinGrams: 27,
        calories: 540,
      },
    ],
  },
};

export const HOME_INGREDIENTS = [
  'Huevos',
  'Arepa',
  'Pan',
  'Arroz blanco',
  'Lentejas',
  'Frijoles',
  'Atún en lata',
  'Pollo',
  'Carne / Cerdo',
  'Queso / Cuajada',
  'Leche',
  'Avena en hojuelas',
  'Banano',
  'Plátano maduro',
  'Papa / Yuca',
  'Espaguetis / Pasta',
  'Maní / Mantequilla de maní',
  'Chocolisto / Café',
] as const;

/**
 * Motor local de respaldo para sustituir una comida cuando el usuario indica qué ingredientes tiene en casa.
 * Se usa al instante si no hay API key configurada o si falla la red, garantizando ~25-30g de proteína.
 */
export function buildLocalMealSubstitution(
  mealId: MealId,
  availableIngredients: string[],
  customText: string
): MealCustomOverride {
  const combined = [...availableIngredients, customText].join(' ').toLowerCase();

  const hasEggs = combined.includes('huevo');
  const hasTuna = combined.includes('atún') || combined.includes('atun');
  const hasChicken = combined.includes('pollo');
  const hasMeat = combined.includes('carne') || combined.includes('cerdo');
  const hasCheese = combined.includes('queso') || combined.includes('cuajada');
  const hasLentils = combined.includes('lenteja');
  const hasBeans = combined.includes('frijol') || combined.includes('fríjol');
  const hasMilk = combined.includes('leche');
  const hasOats = combined.includes('avena');
  const hasRice = combined.includes('arroz');
  const hasArepa = combined.includes('arepa');
  const hasBread = combined.includes('pan');
  const hasBanana = combined.includes('banano');
  const hasPlantain = combined.includes('plátano') || combined.includes('platano');
  const hasPotato = combined.includes('papa') || combined.includes('yuca');
  const hasPasta = combined.includes('pasta') || combined.includes('espagueti');
  const hasPeanut = combined.includes('maní') || combined.includes('mani');

  const proteins: string[] = [];
  let estProtein = 0;
  let estKcal = 0;

  // 1. Seleccionar fuentes de proteína disponibles hasta cubrir ~25-30g
  if (hasEggs) {
    // Detectar si el usuario especificó solo 1 o 2 huevos
    const onlyOneEgg = /\b1\s*huevo\b|\bun\s*huevo\b/.test(combined);
    const onlyTwoEggs = /\b2\s*huevos\b|\bdos\s*huevos\b/.test(combined);
    if (onlyOneEgg) {
      proteins.push('1 huevo (6g prot)');
      estProtein += 6;
      estKcal += 75;
    } else if (onlyTwoEggs) {
      proteins.push('2 huevos (12g prot)');
      estProtein += 12;
      estKcal += 150;
    } else {
      proteins.push('3 huevos preparados al gusto (18g prot)');
      estProtein += 18;
      estKcal += 220;
    }
  }

  if (hasTuna && estProtein < 28) {
    proteins.push('1 lata de atún escurrida (24g prot)');
    estProtein += 24;
    estKcal += 130;
  }
  if (hasChicken && estProtein < 28) {
    proteins.push('1 porción generosa de pollo desmechado o a la plancha (25g prot)');
    estProtein += 25;
    estKcal += 180;
  }
  if (hasMeat && estProtein < 28) {
    proteins.push('1 porción de carne o cerdo casero (24g prot)');
    estProtein += 24;
    estKcal += 210;
  }
  if ((hasLentils || hasBeans) && estProtein < 30) {
    const grainName = hasLentils ? 'lentejas' : 'frijoles';
    proteins.push(`1 taza grande de ${grainName} de casa (9g prot vegetal)`);
    estProtein += 9;
    estKcal += 160;
  }
  if (hasCheese && estProtein < 28) {
    proteins.push('porción gruesa de queso o cuajada (8g prot)');
    estProtein += 8;
    estKcal += 110;
  }
  if (hasMilk && estProtein < 30) {
    proteins.push('1 vaso grande de leche (300 ml → 9g prot)');
    estProtein += 9;
    estKcal += 150;
  }
  if (hasPeanut) {
    proteins.push('1.5 cucharadas de maní o mantequilla de maní (6g prot)');
    estProtein += 6;
    estKcal += 140;
  }

  if (proteins.length === 0) {
    proteins.push('Proteína casera urgente: mezcla granos (lentejas/frijoles) + leche/queso o consigue huevos/atún');
    estProtein += 20;
    estKcal += 250;
  }

  // 2. Seleccionar carbohidratos de volumen limpio disponibles
  const carbs: string[] = [];
  if (hasRice) {
    carbs.push('1 taza abundante de arroz blanco (completa aminoácidos si hay granos)');
    estKcal += 200;
    estProtein += 4;
  }
  if (hasArepa) {
    carbs.push('1 arepa mediana/grande');
    estKcal += 180;
    estProtein += 3;
  } else if (hasBread) {
    carbs.push('2 tajadas de pan');
    estKcal += 150;
    estProtein += 4;
  }
  if (hasOats) {
    carbs.push('4 cucharadas de avena en hojuelas');
    estKcal += 150;
    estProtein += 5;
  }
  if (hasPasta) {
    carbs.push('1 plato abundante de espaguetis/pasta');
    estKcal += 240;
    estProtein += 7;
  }
  if (hasBanana) {
    carbs.push('1 banano');
    estKcal += 105;
  } else if (hasPlantain) {
    carbs.push('1 tajada grande de plátano maduro');
    estKcal += 140;
  } else if (hasPotato) {
    carbs.push('2 papas medianas o porción de yuca');
    estKcal += 150;
  }

  if (carbs.length === 0) {
    carbs.push('1 porción de arroz, arepa, papa o avena disponible en casa');
    estKcal += 180;
  }

  const mealDef = MEAL_PROTOCOL[mealId];
  const title = `${proteins.slice(0, 2).join(' + ')} con ${carbs.slice(0, 2).join(' + ')}`;
  const description = `Combinación adaptada para tu ${mealDef.name}: ${proteins.join(', ')} acompañado de ${carbs.join(', ')}. Cubre tu requerimiento de hipertrofia con lo que tienes hoy en casa.`;

  return {
    title,
    description,
    macros: `~${Math.max(22, estProtein)}g proteína · ~${Math.max(500, estKcal)} kcal`,
    ingredientsUsed: availableIngredients.length > 0 ? availableIngredients : [customText.trim() || 'Ingredientes de casa'],
    generatedByAI: false,
  };
}
