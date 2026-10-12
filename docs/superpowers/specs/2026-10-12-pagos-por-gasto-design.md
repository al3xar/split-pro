# Pagos por gasto (saldar gastos concretos)

- **Fecha:** 2026-10-12
- **Estado:** aprobado en conversación, pendiente de revisión escrita
- **Ámbito:** fork de SplitPro para gastos de casa en pareja (funciona también en grupos)

## 1. Objetivo

Hoy SplitPro calcula un saldo neto entre personas y "Saldar" crea un gasto de compensación
(`SplitType.SETTLEMENT`) por un importe libre. Ningún gasto queda marcado como pagado.

Queremos:

1. Que cada gasto tenga estado propio: **pendiente**, **a cuenta** o **pagado**.
2. Que "Saldar" sea un **selector de gastos completos** (nunca importes parciales). Se suman los
   elegidos y se paga ese total en un único pago.
3. Que solo pueda saldar quien es **deudor neto** ("solo puedes saldar si el otro no te debe nada").
4. Que un gasto que reduce tu deuda quede **pagado al instante** como saldo a favor, que se descuenta
   en el siguiente pago.

### Criterios de éxito

- El saldo solo suma gastos no pagados.
- Cada gasto muestra su estado y, si está pagado, en qué pago y cuándo.
- Un gasto recurrente nuevo (p. ej. el alquiler del mes siguiente) nace pendiente.
- Nunca se registra un pago por un importe distinto del que vio quien lo confirma.

### Fuera de alcance

- Pagos parciales de un gasto o pagos "a cuenta" de importe libre.
- Migrar liquidaciones `SETTLEMENT` existentes (se asume instalación nueva).
- Análisis por categoría y calendario (irán en especificaciones aparte).

## 2. Modelo de datos

### Tablas nuevas

```prisma
model Settlement {
  id         String               @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  groupId    Int?
  currency   String
  simplified Boolean              @default(false)
  createdBy  Int
  createdAt  DateTime             @default(now())
  group        Group?               @relation(fields: [groupId], references: [id], onDelete: Cascade)
  createdByUser User                @relation(fields: [createdBy], references: [id], onDelete: Cascade)
  transfers    SettlementTransfer[]
  participants ExpenseParticipant[]

  @@index([groupId])
  @@schema("public")
}

model SettlementTransfer {
  id           Int        @id @default(autoincrement())
  settlementId String     @db.Uuid
  fromUserId   Int
  toUserId     Int
  amount       BigInt     // siempre > 0, en unidades mínimas de la moneda
  settlement   Settlement @relation(fields: [settlementId], references: [id], onDelete: Cascade)
  fromUser     User       @relation("TransferFrom", fields: [fromUserId], references: [id], onDelete: Cascade)
  toUser       User       @relation("TransferTo", fields: [toUserId], references: [id], onDelete: Cascade)

  @@index([settlementId])
  @@schema("public")
}
```

- Un pago normal tiene **una** transferencia (deudor → acreedor).
- Un cierre simplificado de grupo tiene **N** transferencias.
- Un pago con neto 0 ("cerrar cuentas") tiene **cero** transferencias.

### Cambio en `ExpenseParticipant`

```prisma
settlementId String?     @db.Uuid
settlement   Settlement? @relation(fields: [settlementId], references: [id], onDelete: SetNull)
@@index([settlementId])
```

- Solo se rellena en las filas que cuentan para el saldo: las de participantes que **no** son el
  pagador del gasto (`userId <> paidBy`). La fila del pagador nunca se marca.
- Borrar un `Settlement` devuelve sus filas a `NULL` (deshacer pago).

### Estado de una fila (derivado, no se guarda)

Para cada par de usuarios + grupo + moneda se calcula el **neto** con las filas sin pago. El signo
del neto indica el **deudor**. Cada fila sin pago es:

| Estado      | Condición                                                      |
|-------------|----------------------------------------------------------------|
| Pagado      | `settlementId IS NOT NULL`                                     |
| Pendiente   | sin pago y la deuda de la fila va del deudor neto al acreedor  |
| A cuenta    | sin pago y la deuda de la fila va en sentido contrario         |
| (sin deuda) | neto 0: todas las filas sin pago se muestran como pendientes   |

Como el estado se deriva, se recoloca solo cuando cambia quién es el deudor.

## 3. Cálculo de saldos

- `prisma/views/public/BalanceView.sql`: añadir `AND ep."settlementId" IS NULL` al `WHERE`
  de `BaseBalance`. Se crea con una migración nueva (`CREATE OR REPLACE VIEW`).
- `get_balance_at_date(before_date)`: una fila cuenta como no pagada en esa fecha si
  `ep."settlementId" IS NULL OR s."createdAt" > before_date` (join con `Settlement`).
- `duplicate_expense_with_participants()`: no cambia. Inserta una lista explícita de columnas, así
  que la copia nace con `settlementId = NULL`. Se cubre con una prueba.
- `src/lib/simplify.ts`: no cambia. Trabaja sobre `BalanceView`.

## 4. Lógica central: `src/lib/settlement.ts`

Módulo puro, sin acceso a base de datos, usado por servidor y cliente.

```ts
interface SettleRow {
  expenseId: string;
  userId: number;     // participante deudor de la fila
  paidBy: number;     // acreedor de la fila
  amount: bigint;     // ExpenseParticipant.amount (negativo = debe)
  currency: string;
  groupId: number | null;
  recurrent: boolean;
  category: string;
  expenseDate: Date;
}

interface PairState {
  debtorId: number | null;   // null si neto = 0
  creditorId: number | null;
  net: bigint;               // >= 0, lo que debe el deudor
  pending: SettleRow[];
  onAccount: SettleRow[];
}

function getPairState(rows: SettleRow[], userA: number, userB: number): PairState;

function evaluateSelection(state: PairState, selected: RowKey[]):
  | { ok: true; total: bigint; rows: SettleRow[] }   // rows = seleccionadas + todas las a cuenta
  | { ok: false; reason: 'NOT_PENDING' | 'BELOW_ON_ACCOUNT'; minimum?: bigint };
```

Reglas:

- `total = Σ seleccionadas − Σ a cuenta`.
- `total < 0` → `BELOW_ON_ACCOUNT` con `minimum = Σ a cuenta`. Un pago nunca invierte la deuda.
- Las filas a cuenta se incluyen siempre y enteras.
- Con neto 0 se permite un pago de 0 € que incluye todas las filas sin pago ("cerrar cuentas").
- Una moneda por pago. Las filas de otra moneda o de otro grupo se ignoran.

## 5. API (router tRPC `settlement`)

| Procedimiento      | Entrada                                                         | Efecto |
|--------------------|-----------------------------------------------------------------|--------|
| `getPending`       | `{ friendId \| groupId, currency }`                             | Devuelve `PairState` (en grupo: del usuario actual con cada miembro). |
| `create`           | `{ friendId \| groupId, currency, selected: RowKey[], expectedTotal }` | Crea un pago normal. |
| `createSimplified` | `{ groupId, currency, expectedTransfers }`                      | Cierra todo el grupo con transferencias simplificadas. |
| `delete`           | `{ settlementId }`                                              | Deshace el pago. |
| `get`              | `{ settlementId }`                                              | Detalle: transferencias y gastos incluidos. |

### `create` (en una transacción)

1. `SELECT … FOR UPDATE` sobre las filas sin pago del par + grupo + moneda.
2. `getPairState` y `evaluateSelection` con la función pura.
3. Valida: el usuario actual es deudor o acreedor del par; selección válida;
   `total === expectedTotal`. Si no coincide → `CONFLICT` ("los gastos han cambiado").
4. Inserta `Settlement`, una `SettlementTransfer` (deudor → acreedor por `total`, o ninguna si es 0)
   y actualiza `settlementId` de las filas.
5. Notifica al otro (servicio de notificaciones actual).

Cualquiera de los dos puede registrarlo; el sentido siempre es deudor → acreedor.

### `createSimplified`

- Requiere `group.simplifyDebts = true`.
- Bloquea todas las filas sin pago del grupo en esa moneda, calcula transferencias con
  `simplifyDebts()` y compara con `expectedTransfers`. Si difieren → `CONFLICT`.
- Marca **todas** esas filas con el nuevo `settlementId`.

### `delete`

- Permitido a cualquier usuario con una transferencia en el pago o miembro de su grupo.
- Borra el `Settlement` (cascada a transferencias, `SetNull` en filas) y notifica.

### Cambios en procedimientos existentes

- `expense.addOrEditExpense` (edición) y `expense.deleteExpense`: `CONFLICT` si alguna fila del
  gasto tiene `settlementId` ("Deshaz el pago para editarlo").
- `expense.addOrEditExpense`: rechaza `splitType = SETTLEMENT` en gastos nuevos.

## 6. Pantallas

### "Saldar" (sustituye a `Settleup.tsx` y `GroupSettleup.tsx`)

- **Paso 1 (como hoy):** elegir saldo (grupo/moneda) si hay varios.
- **Paso 2 (selector):**
  - Cabecera: quién paga a quién.
  - Chips de filtro rápido: "Todos", "Fijos" (recurrentes) y una por categoría presente.
    Pulsar un chip deja marcados solo esos gastos.
  - Lista de pendientes agrupada por mes, con casilla, fecha, icono de categoría, nombre e importe
    que se debe. Todos marcados por defecto.
  - Bloque "A cuenta" sin casillas, con su suma.
  - Pie fijo: `Seleccionado X − A cuenta Y = Total Z` y botón "Registrar pago de Z".
    Desactivado con aviso "Selecciona al menos Y" si `Z < 0`.
  - En grupos con simplificación activada: opción "Simplificar", habilitada solo si están marcados
    **todos** los pendientes; muestra las transferencias resultantes antes de confirmar.
- Desaparece el campo de importe libre.
- Ante `CONFLICT`: recargar datos y mostrar el nuevo total antes de volver a confirmar.

### Lista de gastos

- Pendiente: como hoy.
- Pagado: atenuado, con ✓.
- A cuenta: etiqueta "a cuenta".
- Los pagos aparecen en su fecha ("Pagaste 520 € · 3 gastos"). Al tocarlos se abre su detalle,
  con los gastos incluidos y el botón "Deshacer pago" (con confirmación).

### Detalle de gasto

- Estado: "Pagado el 5 oct, en un pago de 520 €" con enlace al pago.
- Editar y borrar desactivados si está pagado.

### Cabecera de saldo

- "Debes 350 €" y debajo "400 € pendientes − 50 € a cuenta".

### Liquidaciones antiguas

- Las filas `SETTLEMENT` existentes se muestran en solo lectura. Se elimina su formulario de
  edición en `ExpenseDetails.tsx`.

## 7. Pruebas

### Unitarias (Jest, `src/tests/settlement.test.ts`)

- Estado de filas: pendiente / a cuenta / neto 0.
- Ejemplo base: alquiler 400 € pendiente + compra 100 € a medias → total 350 €.
- Inversión: compra de 1000 € → la deudora pasa a ser la otra persona por 100 €.
- Selección por debajo del saldo a favor → `BELOW_ON_ACCOUNT` con el mínimo correcto.
- Neto 0 → pago de 0 € con todas las filas.
- Filas de otra moneda o grupo ignoradas.

### Integración contra Postgres (`pnpm test:db`, opt-in)

Usa el Postgres con `pg_cron` del entorno de desarrollo (Docker).

- `BalanceView` excluye filas pagadas.
- `get_balance_at_date()` antes y después de un pago.
- `duplicate_expense_with_participants()` produce filas sin `settlementId`.
- Dos `create` concurrentes sobre las mismas filas → uno `CONFLICT`.
- `delete` devuelve las filas a pendiente y el saldo al valor previo.
- Editar o borrar un gasto pagado → `CONFLICT`.

### Manual

Flujo completo en el navegador: pareja (alquiler + compra + inversión + deshacer) y grupo de 3 con
simplificación.
