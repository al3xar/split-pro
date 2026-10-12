# Análisis de gastos, ingresos e inversiones

- **Fecha:** 2026-10-12
- **Estado:** implementado en `feature/analisis`

## Objetivo

Ver de un vistazo cuánto se gasta, en qué, y cuánto se ahorra cada mes. Ingresos e inversiones
son personales (solo los ve su dueño); los gastos salen de los gastos compartidos de SplitPro.

## Definiciones

- **Gastos del mes:** la parte que le toca al usuario de cada gasto en el que participa
  (`paidBy === yo ? amount : 0` − `ExpenseParticipant.amount`). Se excluyen `SETTLEMENT` y
  `CURRENCY_CONVERSION`, y los gastos borrados.
- **Total del hogar:** suma de los importes completos de esos gastos (dato secundario).
- **Ahorro:** ingresos − gastos. Las inversiones forman parte del ahorro, no se restan.
- **Meses:** se agrupan en la zona horaria del navegador (no en UTC), para que un gasto del día 1
  a medianoche no caiga en el mes anterior.
- **Moneda:** una a la vez. Por defecto la moneda por defecto del usuario si tiene datos; si no,
  la más usada. Selector si hay varias.

## Modelo

`FinanceEntry` (`INCOME` | `INVESTMENT`, importe en unidades mínimas, moneda, categoría fija por
tipo, descripción opcional, fecha). Categorías en `src/lib/finance.ts`.

## Pantallas

- `/analytics` (nueva entrada "Análisis" en la navegación): selector de mes (en la URL),
  4 tarjetas (gastos con variación frente al mes anterior y total del hogar, ingresos, ahorro con
  tasa de ahorro, invertido), desglose por categoría expandible a subcategorías, gráfica de
  ingresos vs gastos de 12 meses con vista en tabla, y gráfica de ahorro mensual (positivo/negativo).
- `/finances`: ingresos e inversiones del mes, alta/edición/borrado en un cajón, y
  "Copiar del mes anterior" cuando el mes está vacío.

## Gráficas

Paleta validada con el validador de dataviz (claro y oscuro, segura para daltonismo): ingresos
azul, gastos naranja, ahorro azul/rojo. Un solo eje, barras finas con extremo redondeado, leyenda
con 2 series, etiqueta al pasar el ratón o al enfocar con teclado (cada mes es un botón con
`aria-label` completo), tabla equivalente.

## Accesibilidad y usabilidad (resto de la app)

- Anillo de foco visible (en oscuro `--ring` era casi igual que el fondo) y `:focus-visible` global.
- `prefers-reduced-motion` respetado.
- Navegación: `aria-current`, contraste suficiente en elementos inactivos, objetivos táctiles ≥ 44 px.
- Cajones móviles con `DrawerTitle` (antes un `<p>`: sin nombre accesible).
- Añadir gasto: selector de categoría convertido en botón con nombre visible; pistas que explican
  que los campos aparecen al elegir persona y al escribir descripción e importe; etiquetas en los
  campos de descripción e importe; título como `h1`.
