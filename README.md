# FocusOS - Strict Mode

Sistema de productividad personal basado en bloques de tiempo obligatorios, diseñado para eliminar la procrastinación mediante disciplina estructurada y métricas reales.

## Características Principales

### 🎯 Sistema de Bloques
- **Bloques Profundos**: Sesiones de trabajo intenso de 60 minutos (configurable)
- **Ejercicio Obligatorio**: Bloque diario de actividad física
- **Bloques Ligeros**: Tareas de menor intensidad
- **Descansos**: Pausas programadas automáticamente

### 📊 Métricas en Tiempo Real
- Puntuación de disciplina diaria (0-100%)
- Seguimiento de bloques completados vs fallados
- Horas profundas acumuladas
- Racha de días consecutivos con alta disciplina
- Análisis semanal y mensual

### ⚡ Modo Enfoque
- Pantalla minimalista durante bloques activos
- Temporizador en tiempo real
- Advertencias al intentar salir de bloques profundos
- Registro de interrupciones

### 🔔 Sistema de Notificaciones (Android)
- **Notificaciones Web API** compatible con navegadores Android
- **5 minutos antes**: Aviso previo al inicio del bloque
- **Inicio exacto**: Notificación al comenzar el bloque
- **Mitad del bloque**: Recordatorio de progreso
- **Fin del bloque**: Aviso de finalización
- **Advertencia de retraso**: Si no inicias en 3 minutos
- **Alertas de interrupción**: Si sales durante un bloque profundo
- **Recordatorio diario**: Para configurar bloques del día (8:30 AM)
- **Vibraciones personalizadas** para cada tipo de notificación

### 🛠️ Personalización Total
- Configurar horarios personales (despertar, SENA, llegada a casa)
- Definir pico de energía (mañana, tarde, noche)
- Ajustar cantidad de bloques profundos diarios (1-3)
- Personalizar duración de bloques (40-90 min)
- Control de tiempo máximo en redes sociales

### 📅 Planificador Inteligente
- Crear tareas con fechas de entrega
- Asignar prioridades y dificultad
- Programar bloques manualmente o automáticamente
- Vista diaria de todos los bloques

## Navegación

### 🏠 Inicio
- Reloj en tiempo real
- Puntuación de disciplina del día
- Bloque actual (si está activo)
- Próximo bloque programado
- Acceso rápido a otras secciones

### 🎯 Enfoque
- Modo de trabajo activo
- Temporizador con cuenta regresiva
- Información de la tarea actual
- Botones "Cumplido" y "Fallé"
- Advertencias para bloques profundos

### 📅 Planificador
- Lista de tareas pendientes
- Bloques programados por día
- Agregar nuevas tareas y bloques
- Configuración rápida del día (1, 2 o 3 bloques)

### 📊 Métricas
- Vista semanal/mensual
- Disciplina promedio
- Tasa de cumplimiento
- Horas profundas totales
- Racha actual
- Historial diario detallado

### ⚙️ Configuración
- Horarios personales
- Preferencias de energía
- Configuración de bloques profundos
- Ejercicio obligatorio
- Límites de redes sociales

## Filosofía del Sistema

**Estructura > Motivación**
El sistema no depende de tu motivación, te dice qué hacer y cuándo.

**Disciplina > Emoción**
Las decisiones están basadas en reglas fijas, no en cómo te sientes.

**Métrica > Sensación**
Mides tu progreso con datos reales, no con percepciones.

## Sistema de Penalizaciones

- **Bloque profundo fallado**: -20 puntos
- **Ejercicio fallado**: -15 puntos
- **Interrupción registrada**: -5 puntos
- **Día bajo 70%**: Marcado como bajo rendimiento
- **7 días sobre 85%**: Racha positiva activa

## Tecnologías

- React + TypeScript
- React Router (navegación multi-página)
- Tailwind CSS v4 (diseño mobile-first)
- Lucide React (iconos)
- Sistema de store personalizado (preparado para Supabase)

## Uso

1. **Configuración inicial**: Ve a Configuración y ajusta tus horarios personales
2. **Habilitar notificaciones**: En Configuración, activa el switch de notificaciones y permite los permisos en tu navegador
3. **Agregar tareas**: En el Planificador, crea tus tareas con fechas de entrega
4. **Programar día**: El sistema te preguntará cuántos bloques profundos quieres
5. **Ejecutar**: Cuando llegue la hora, accede al Modo Enfoque
6. **Revisar**: Consulta tus métricas para ver tu progreso

## Configuración de Notificaciones en Android

### Chrome/Edge para Android:
1. Abre la app en tu navegador
2. Ve a **Configuración** (⚙️)
3. Activa el switch **"Habilitar notificaciones"**
4. Permite los permisos cuando el navegador lo solicite
5. Usa el botón **"Probar notificación"** para verificar que funciona

### Firefox para Android:
1. Igual que Chrome, pero asegúrate de permitir notificaciones en la configuración del navegador
2. Menú → Configuración → Notificaciones → Permitir

### Consejos para Android:
- **No cerrar la pestaña**: Mantén la app abierta en segundo plano para recibir notificaciones
- **Agregar a pantalla de inicio**: Desde el menú del navegador, selecciona "Agregar a pantalla de inicio" para acceso rápido
- **Permitir en segundo plano**: En la configuración de Android, permite que el navegador funcione en segundo plano
- **No limpiar RAM**: Evita cerrar el navegador con limpiadores de memoria para mantener las notificaciones activas

## Próximas Mejoras Sugeridas

- Integración con Supabase para persistencia de datos
- Notificaciones push para alertas de bloques
- Modo "Entrega Urgente" que reorganiza automáticamente
- Bloqueo de apps durante bloques profundos
- Sincronización con Google Calendar
- Estadísticas avanzadas con gráficos
- Exportación de datos y reportes