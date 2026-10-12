# Añadir gasto global, importación de extractos y asistente

- **Fecha:** 2026-10-13 · **Estado:** aprobado en conversación · **Diseño visual:** `docs/DESIGN.md`
- Orden: A (diálogo) → B (extractos y bandeja) → C (asistente). Despliegue tras cada parte.

## A. Diálogo global "Añadir gasto"

- Store `useAddExpenseDialog` (zustand): `{ open, prefill, openWith(prefill?), close }`.
- `AddExpenseDialog` montado una vez en `_app` (dentro de la sesión): diálogo centrado en
  escritorio, casi pantalla completa en móvil, con el formulario completo de siempre
  (`AddOrEditExpensePage`).
- La inicialización que hoy hace `pages/add.tsx` (usuario, grupo, amigo, moneda, reparto por
  defecto, edición) pasa a un hook `useInitAddExpense({ user, groupId, friendId, expenseId })`
  usado por la página y por el diálogo.
- `AddOrEditExpensePage` acepta `onSaved?(expenseId)` y `onCancel?()`; si existen no navega.
- La configuración que la página recibe del servidor (invitaciones, banco, tamaño de subida) se
  sirve con `expense.getAddConfig`.
- `prefill`: `{ groupId?, friendId?, name?, amount?: bigint, currency?, category?, paidById?,
  expenseDate?, transactionId?, onSaved? }`. Con `groupId`, el reparto por defecto del grupo.
- Abren el diálogo: "Añadir" del menú (móvil y escritorio), botón "+" en Hogar, Saldos, Grupos y
  Análisis (con el grupo/amigo de la pantalla), la bandeja (B) y el asistente (C).
- `/add` sigue funcionando (edición y enlaces existentes).

## B. Importación de extractos, bandeja y gastos personales

### Datos
- `ImportedTransaction { id uuid, userId, hash, date, description, amount BigInt (con signo:
  negativo = salida), currency, source, status PENDING|SHARED|PERSONAL|INCOME|IGNORED,
  category?, expenseId?, financeEntryId?, createdAt }`, único `(userId, hash)`.
- `ImportProfile { id, userId, name, mapping Json }` (columnas, formato de fecha, separador
  decimal, moneda) para repetir importaciones del mismo banco.
- `TransactionRule { id, userId, pattern, action SHARED|PERSONAL|INCOME|IGNORED, category? }`.
- `FinanceEntryType` gana `EXPENSE` (gasto personal; categorías = las de SplitPro).

### Lógica pura (`src/lib/statement.ts`, `src/lib/categoryGuess.ts`)
- CSV con detección de separador (`;` `,` tab), comillas, cabecera; fechas `dd/MM/yyyy`,
  `dd-MM-yyyy`, `dd.MM.yyyy`, `yyyy-MM-dd` e ISO con hora; importes `1.234,56`, `-12,50`,
  `12.50`, columnas separadas cargo/abono; detección automática de columnas por nombre
  (fecha/date/datetime, concepto/descripción/description, importe/amount, cargo/abono…).
- Hash = fecha + importe + descripción normalizada + nº de repetición en el fichero.
- `guessCategory(text)` (palabras clave, compartido con Tricount) y `matchRule(rules, text)`.
- Excel: v1 solo CSV (los bancos permiten exportar CSV o guardar el Excel como CSV).

### Pantallas
- `/bank-import`: subir CSV → vista previa con columnas detectadas y editables → guardar
  plantilla → importar a la bandeja (resumen: nuevos / ya existentes).
- `/inbox` (Bandeja; enlace en Cuenta y aviso con contador en Hogar): pendientes con fecha,
  concepto, importe y sugerencia (regla o palabra clave). Acciones por movimiento:
  - **Compartido** → diálogo de A prellenado (Hogar, importe absoluto, concepto, fecha,
    categoría); al guardar, el movimiento queda `SHARED` con su `expenseId`.
  - **Solo mío** → categoría + confirmar → `FinanceEntry EXPENSE`.
  - **Ingreso** (importes positivos) → `FinanceEntry INCOME`.
  - **Ignorar**.
  - Casilla "Recordar para «patrón»" (activada) crea/actualiza una `TransactionRule`.
  - Selección múltiple para Solo mío / Ignorar en bloque.
- Análisis: gastos del mes = tu parte de compartidos + gastos personales; categorías incluyen los
  personales. Ingresos e inversiones: sección "Gastos personales".

## C. Asistente

- Variables de servidor: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_MAX_STEPS` (5). Sin
  `LLM_BASE_URL` el asistente no aparece. Cliente `POST {base}/chat/completions` compatible con
  OpenAI con `tools`; timeout 60 s.
- `ChatConversation { id uuid, userId, title, createdAt, updatedAt }`,
  `ChatMessage { id, conversationId, role user|assistant|tool, content, toolCalls Json?,
  toolCallId?, createdAt }`.
- Herramientas (servidor, limitadas al usuario y su grupo Hogar):
  `list_expenses`, `get_summary(period)`, `get_pending_debts`, `list_inbox`,
  `propose_expense` (no crea: devuelve un prefill que la UI abre en el diálogo de A; el resultado
  —guardado o cancelado— se añade a la conversación).
- Bucle: hasta `LLM_MAX_STEPS` rondas de herramientas por mensaje; argumentos validados con zod;
  datos de la base tratados como datos; ninguna escritura sin pasar por el diálogo.
- UI: `/assistant` (lista de conversaciones, chat, sugerencias), botón flotante en Hogar y
  Análisis, entrada en Cuenta.

## Pruebas
- Unitarias: parser CSV (separadores, comillas, fechas, importes, cargo/abono, detección,
  hash/duplicados), `guessCategory`/`matchRule`, analytics con gastos personales, bucle del
  asistente con LLM simulado (herramientas, límite de rondas, propose no escribe).
- Manual en local (build de producción) y despliegue con copia de seguridad.
