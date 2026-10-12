# DESIGN.md — SplitPro (fork Hogar)

Lenguaje visual del fork. Sigue la estructura de 9 secciones de los `DESIGN.md` de
[awesome-claude-design](https://github.com/VoltAgent/awesome-claude-design). Dirección: **fintech
cercana y clara** (dinero compartido en casa, sin tono bancario frío), sobre la identidad existente
de SplitPro (cian, Poppins, tema oscuro de origen).

## 1. Visual Theme & Atmosphere

- Tranquila, legible y "de casa": superficies planas, mucho aire, un solo acento.
- El dinero es el protagonista: cifras grandes y claras, etiquetas pequeñas y sobrias.
- Densidad media en móvil (una columna), algo más densa en escritorio (2–4 columnas en tarjetas).
- Dos temas de primera clase: **oscuro** (origen) y **claro**. Ninguno es una inversión automática
  del otro: cada token tiene su valor en cada tema.

## 2. Color Palette & Roles

Todos los colores se usan **por rol** (tokens CSS en `src/styles/globals.css`), nunca como clases
de color fijas (`text-gray-500`, `bg-gray-800`…).

| Rol (token)          | Claro              | Oscuro                    | Uso                                    |
| -------------------- | ------------------ | ------------------------- | -------------------------------------- |
| `--background`       | `hsl(0 0% 100%)`   | `hsl(224 71% 4%)`         | fondo de página                        |
| `--card`             | `hsl(0 0% 100%)`   | `hsl(224 71% 4%)`         | tarjetas (se distinguen por borde)     |
| `--foreground`       | `hsl(224 71% 4%)`  | `hsl(222 2% 83%)`         | texto principal                        |
| `--muted-foreground` | `hsl(220 9% 46%)`  | `hsl(218 11% 65%)`        | texto secundario, etiquetas (≥ 4.5:1)  |
| `--muted`            | `hsl(220 14% 96%)` | `hsl(215 28% 17%)`        | fondos suaves, chips, pistas           |
| `--border`           | `hsl(220 13% 91%)` | `hsl(215 28% 17%)`        | bordes de tarjeta y separadores        |
| `--primary`          | `hsl(221 39% 11%)` | `hsl(189 94% 43%)` (cian) | acción principal, elemento activo      |
| `--ring`             | `hsl(224 71% 4%)`  | `hsl(189 94% 43%)`        | anillo de foco (siempre visible)       |
| `--destructive`      | `hsl(0 84% 60%)`   | `hsl(0 74% 42%)`          | borrar, deshacer pagos                 |
| `--color-positive`   | emerald-600        | emerald-500               | "te deben", "saldado", ahorro positivo |
| `--color-negative`   | orange-600         | orange-600                | "debes", pendiente                     |

Gráficas (validadas con el script de dataviz, seguras para daltonismo, claro y oscuro):
`--chart-income` azul, `--chart-expense` naranja, `--chart-positive` azul, `--chart-negative` rojo,
`--chart-grid`, `--chart-axis`, `--chart-track`. Series por persona: slot 1 (azul) y slot 2
(naranja). Categorías: slots 1–5 de la paleta de referencia + gris neutro para "Otros".

Reglas:

- Positivo/negativo **nunca solo por color**: siempre con texto ("te deben", "debes") o icono.
- Un solo color de acento por pantalla; los colores de estado no se reutilizan como series.

## 3. Typography Rules

- Familia: **Poppins** (ya cargada con `next/font`), pesos 400/500/600; 700 solo en cifras héroe.
- Escala: 12 (`text-xs`, etiquetas y pistas) · 14 (`text-sm`, cuerpo de listas) · 16 (`text-base`,
  títulos de tarjeta) · 24 (`text-2xl`, cifras de tarjetas) · 30 (`text-3xl`, título de página).
- Cifras: `tabular-nums` solo en columnas alineadas (listas, tablas, ejes); proporcionales en
  cifras héroe y tarjetas.
- Meses y fechas largas: mayúscula solo en la primera letra (`first-letter:uppercase`), nunca
  `capitalize` ("Octubre de 2026", no "Octubre De 2026").
- Importes con el formateador de moneda de la app (`toUIString`), nunca concatenando "€".

## 4. Component Stylings

- **Tarjeta:** `bg-card rounded-xl border p-4`; título `text-base font-semibold`, subtítulo
  `text-xs text-muted-foreground` (primera letra en mayúscula).
- **Tarjeta de cifra (StatTile):** etiqueta con icono 16px, cifra `text-2xl font-semibold`,
  contexto en `text-xs` (variación, desglose).
- **Botones:** variantes existentes (`default`, `secondary`, `ghost`, `outline`, `destructive`).
  Altura mínima 44px en acciones táctiles (`h-11`). Iconos solos llevan `aria-label`.
- **Chips de elección:** píldora `min-h-11 rounded-full border px-4`, seleccionada con
  `border-primary bg-primary/15`; semántica `role="radiogroup"`/`radio` o `aria-pressed`.
- **Filas de lista:** botón a todo el ancho `min-h-14`, nombre (truncado) + metadatos `text-xs`
  a la izquierda, importe `font-semibold tabular-nums` a la derecha.
- **Deuda pendiente:** importe restante destacado + "de X" en secundario + barra fina de progreso
  (`--chart-track` / `--color-negative`); saldado = icono ✓ + texto "Saldado", atenuado.
- **Cajones/diálogos:** `AppDrawer` (cajón en móvil, diálogo en escritorio) con título accesible.
- **Pistas:** `bg-muted/60 text-muted-foreground rounded-lg px-3 py-2 text-sm`, `role="note"`.
- **Estados vacíos:** tarjeta centrada con título, una frase y como mucho dos acciones.

## 5. Layout Principles

- Escala de espacio de Tailwind; ritmo vertical entre tarjetas `gap-4`, dentro `gap-2`/`gap-3`.
- Una columna en móvil; en `lg` el contenido mide `max-w-3xl` con navegación lateral.
- Rejillas de tarjetas de cifra: 2 columnas en móvil, 4 en `lg`.
- Orden de pantalla: lo accionable (saldo, pendiente) antes que lo analítico (gráficas).

## 6. Depth & Elevation

- Plano: las superficies se separan por **borde**, no por sombra.
- Sombra solo en elementos flotantes (tooltips, menús, cajones): `shadow-lg`.
- Estados de carga: mantener el contenido anterior al 60 % de opacidad, sin esqueletos que salten.

## 7. Do's and Don'ts

- ✅ Tokens de tema para todo color; validar paletas de gráficas con el script.
- ✅ Foco visible siempre (`:focus-visible` con `--ring`); objetivos táctiles ≥ 44px.
- ✅ Todo dato de gráfica accesible también como texto o tabla.
- ✅ Explicar por qué algo no aparece (pistas) en lugar de ocultarlo en silencio.
- ❌ Clases de gris fijas, `capitalize` en fechas, colores como único portador de significado.
- ❌ Quesitos de 2 porciones (usar barra dividida) o con más de 6 (agrupar en "Otros").
- ❌ Gráficas con dos ejes Y.
- ❌ Animaciones que ignoren `prefers-reduced-motion`.

## 8. Responsive Behavior

- Móvil primero (375px de referencia). Barra de navegación inferior de 6 entradas con texto
  truncado, iconos 24px, área táctil completa; respeta `safe-area-inset-bottom`.
- `lg` (≥ 1024px): navegación lateral, tarjetas en rejilla.
- Cajones en móvil, diálogos en escritorio (≥ 768px), mismo contenido.
- Gráficas en HTML/CSS (no SVG escalado) para que el texto mantenga su tamaño.

## 9. Agent Prompt Guide

- "Crea la pantalla X siguiendo `docs/DESIGN.md`: tarjetas con borde, tokens de tema, cifras con
  `toUIString`, foco visible y objetivos de 44px; incluye estado vacío y de carga."
- "Añade una gráfica a X: carga la skill de dataviz, una sola escala, colores `--chart-*`,
  leyenda si hay ≥ 2 series, etiqueta al pasar/enfocar y vista en tabla."
- "Revisa X en claro y en oscuro: sin grises fijos, contraste AA en textos, ≥ 3:1 en iconos y
  bordes de controles."
