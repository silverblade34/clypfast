# Clypfast — Registro de Versiones y Migraciones de Requerimientos

Este directorio funciona como un registro cronológico y versionado (similar a las migraciones de Prisma) de las especificaciones, requerimientos funcionales y planes de arquitectura de Clypfast.

Cada archivo representa un hito o versión del sistema, permitiendo auditar qué se construyó, por qué decisiones técnicas se optó y cómo evoluciona la plataforma.

---

## Catálogo de Versiones

| Migración | Versión | Nombre del Hito | Estado | Fecha |
| :--- | :--- | :--- | :--- | :--- |
| `0001` | **v1.0.0** | MVP Pipeline de Agencia (Detección, Transcripción, Smart Crop y Exportación 6M) | ✅ Completado | 2026-09 |
| `0002` | **v1.1.0** | Fase 2: Modal de Personalización Pre-Descarga (Gancho, Subtítulos, Trim de Tiempos y Zero-Loss Pipeline) | 🚧 En Planificación / Aprobación | 2026-09 |

---

## Estructura Estándar de una Migración de Requerimientos
Cada archivo `000X_*.md` debe contener:
1. **Contexto & Objetivo del Negocio / Creador**
2. **Requerimientos Funcionales (User Stories)**
3. **Restricciones Técnicas Inquebrantables (ej. Calidad de Exportación)**
4. **Arquitectura y Flujo de Datos (Backend / Frontend)**
5. **Criterios de Aceptación y Pruebas de Verificación**
