# Deudas por caja: los fijos solo se saldan a propósito

- **Fecha:** 2026-10-13
- **Estado:** aprobado en conversación, pendiente de revisión escrita
- **Modifica:** `2026-10-12-hogar-design.md` §1 (compensación por prioridad 1-4)

## 0. Objetivo

Hoy todo lo que se deben los dos miembros del hogar se compensa entre sí y lo pendiente se cubre
por prioridad (fijos → comida → resto → ocio). Diez cenas pueden "pagar" un alquiler.

Lo que queremos:

- **Fijos** (alquiler, luz, internet…): nunca se compensan solos. Solo quedan pagados cuando alguien
  registra un pago que los elige. Así la transferencia del banco que dice "Alquiler octubre" tiene su
  pareja en la app.
- **Variables**: se compensan solas, pero solo dentro de su sección (comida con comida, ocio con
  ocio).
- **Historial de Tricount**: los fijos antiguos salen pagados por defecto; se pueden reabrir uno a
  uno.

Criterio de éxito: Hogar y Saldos cuentan la misma cantidad neta. Hogar solo cambia **qué**
deudas aparecen pendientes, nunca **cuánto** se debe en total.

## 1. Reglas

### 1.1 Cajas

Cada deuda (par A–B, un grupo, una moneda, un gasto) cae en una caja:

| Caja | Qué entra | Clave |
|---|---|---|
| Fija | `recurrenceId` no nulo, o categoría `rent`, `mortgage`, `insurance`, o cualquier categoría de la sección `utilities` | `fixed:<expenseId>`: cada gasto fijo es su propia caja |
| Variable | Todo lo demás | `section:<sección>` (`food`, `entertainment`, `home`, `transportation`, `life`, `general`…) |

Los gastos `SETTLEMENT` y `CURRENCY_CONVERSION` no son deudas sino **pagos**. Un pago de D a C es
crédito de D frente a C.

### 1.2 Orden del cálculo

Se recalcula siempre desde cero; no se guarda ningún estado de cobertura.

1. **Pagos con deudas elegidas** (`SettlementTarget`): cubren esas deudas de D con C, en el orden
   elegido, sean fijas o variables. Lo que sobre pasa a crédito libre de D.
2. **Pagos heredados** (importados de Tricount, `transactionId` empieza por `tricount:`): cubren
   las deudas de D con C con la regla antigua: prioridad 1 → 4 y, dentro de cada prioridad, de la
   más antigua a la más nueva. Así los fijos se pagan primero. Se saltan los fijos **reabiertos**
   (§1.4). Lo que sobre pasa a crédito libre de D.
3. **Compensación dentro de cada sección variable**: lo pendiente de A con B y de B con A en la
   misma sección se anula hasta el menor de los dos. Se cubren primero las deudas más antiguas de
   ambos lados.
4. **Créditos libres** (pagos sin deudas elegidas, más lo sobrante de 1 y 2):
   1. Los créditos libres de A y de B se anulan entre sí.
   2. Lo que quede de D cubre las deudas **variables** de D, de la más antigua a la más nueva,
      sin importar la sección. **Nunca** cubre fijas.
   3. Si aún sobra, queda como **"a cuenta"** a favor de D: C le debe ese importe a D.

### 1.3 Estados de cada deuda

| Estado | Significado |
|---|---|
| `pending` | Nada cubierto |
| `partial` | Cubierta en parte |
| `settled` | Cubierta por pagos (pasos 1, 2 o 4) |
| `compensated` | Cubierta solo por compensación de su sección (paso 3) |

Una deuda cubierta en parte por pago y en parte por compensación queda `settled` si llega al 100 %.

### 1.4 Reabrir un fijo importado

- Campo nuevo: `Expense.debtReopenedAt DateTime?`.
- Solo tiene efecto en el paso 2: los pagos heredados no cubren ese gasto, así que sale pendiente y
  su dinero se va a otras deudas.
- La acción "Volver a pendiente" está en los fijos cubiertos por pagos heredados. "Deshacer" borra
  el campo.

### 1.5 Pagado en efectivo o fuera de la app

No hay estado especial: se registra con **Saldar** (un pago que elige ese fijo), igual que una
transferencia. Así Saldos y Hogar siguen cuadrando.

### 1.6 Invariante

Para cada par:

```
(pendiente de A con B) − (pendiente de B con A) + (a cuenta de B) − (a cuenta de A) = saldo neto de A con B
```

El saldo neto es el mismo que muestra Saldos. Se comprueba en los tests con datos aleatorios.

## 2. Interfaces

### 2.1 `src/lib/debts.ts`

Sustituye a `debtPriority` y `remainingByPriority`. `debtPriority` se mantiene **solo** para el
paso 2.

```ts
type DebtBucket = { kind: 'fixed'; expenseId: string } | { kind: 'variable'; section: string };

interface DebtItem {
  expenseId: string;
  debtorId: number;
  creditorId: number;
  category: string;
  bucket: DebtBucket;
  amount: bigint;
  covered: bigint;
  remaining: bigint;
  status: 'pending' | 'partial' | 'settled' | 'compensated';
  coveredByLegacy: boolean; // true si el paso 2 aportó algo (para "Volver a pendiente")
  reopened: boolean;
}

interface PairDebts {
  net: bigint;                    // como hoy: |lo que debe A − lo que debe B|
  netDebtorId: number | null;
  items: DebtItem[];              // solo deudas; los pagos no salen
  owed: Record<number, {          // por deudor: lo pendiente
    fixed: bigint;
    bySection: Record<string, bigint>;
    total: bigint;
  }>;
  advance: { userId: number; amount: bigint } | null; // "a cuenta" (§1.2 paso 4.3)
}

allocateDebts({ userA, userB, currency, expenses, targets }): PairDebts
```

`DebtExpense` gana `transactionId: string | null` y `debtReopenedAt: Date | null`.

### 2.2 tRPC `debts`

- `get`: sin cambios de entrada; devuelve el nuevo `PairDebts` y los metadatos de los gastos.
- `settle({ groupId, friendId, currency, expenseIds, expectedTotal, name })`:
  - Todas las deudas elegidas deben tener el mismo deudor; si no, `BAD_REQUEST`.
  - Paga ese deudor; cualquiera de los dos puede registrar el pago.
  - Se mantienen el bloqueo de concurrencia y la comprobación de `expectedTotal`.
- `reopen({ expenseId, reopened: boolean })` (nuevo):
  - Solo miembros del grupo y solo gastos fijos.
  - Escribe o borra `debtReopenedAt`.

### 2.3 Asistente

`get_pending_debts` devuelve, por cada persona, sus fijos pendientes (nombre, fecha, importe), sus
variables por sección y el "a cuenta".

## 3. Pantallas

### 3.1 Tarjeta de deudas en Hogar

```
Debes a Bea · 545,00 €                 [Saldar]
  Gastos fijos
    Alquiler octubre · 1 oct · 500,00 €        [Saldar]
  Variables
    Comida y bebida · 45,00 €  ▸ (desplegable con cada gasto)
Bea te debe · 12,00 €
  Variables
    Ocio · 12,00 €  ▸
  Pago a cuenta · 0,00 €     (solo si hay)
Ya pagado ▸   (plegado: fijos cubiertos, con "Volver a pendiente" en los heredados)
```

- Se quitan las etiquetas "Prioridad 1-4".
- Si nadie debe nada, se ve el mensaje actual de "Estáis en paz".

### 3.2 Saldar (`DebtSelector`)

- **Arriba, dos pestañas**: "Lo que debo yo" y "Lo que me debe Bea". Solo aparecen las que tienen
  deudas.
- **Lista**:
  - cada fijo, con su casilla;
  - cada sección variable, con su casilla de grupo y sus gastos desplegables y seleccionables uno a
    uno.
- **Nombre del pago**: se rellena solo con lo elegido y se puede editar.
  - Un fijo: su nombre y su mes ("Alquiler octubre").
  - Varios: unidos con " + ", hasta 100 caracteres.
  - Solo variables: "Pago comida y bebida".
- **Botón**: "Registrar pago de 545,00 €".
- **Botón Saldar de cada fijo** en Hogar: abre el selector con solo ese fijo marcado.

## 4. Datos y migración

- Migración Prisma: `ALTER TABLE "Expense" ADD COLUMN "debtReopenedAt" TIMESTAMP(3)`.
- **Datos existentes**: no se tocan.
  - Los pagos creados con Saldar ya tienen sus deudas elegidas.
  - Los pagos sin deudas elegidas se aplican con la regla nueva (solo variables). Esto puede dejar
    pendientes fijos que antes salían cubiertos. En el NAS no hay historial de Tricount todavía;
    antes de desplegar se mirará qué cambia con los datos reales y se avisará.

## 5. Pruebas

Tests unitarios de `allocateDebts`:

1. Diez cenas pagadas por A no cubren el alquiler pagado por B: los dos quedan pendientes.
2. Las cenas se compensan entre sí dentro de "Comida y bebida"; el ocio no se mezcla con la comida.
3. Un pago sin deudas elegidas cubre variables, de la más antigua a la más nueva, y nunca un fijo.
4. Lo sobrante de un pago queda "a cuenta"; un pago posterior del otro lo anula.
5. Un pago con un fijo elegido lo cubre; si sobra, lo sobrante va a variables.
6. El alquiler alterno (un mes A, otro mes B) no se cancela solo.
7. Un gasto recurrente de ocio es fijo.
8. Pagos de Tricount: cubren primero los fijos; un fijo reabierto queda pendiente y ese dinero
   cubre otras deudas.
9. Invariante §1.6 con 200 escenarios aleatorios (semilla fija).

Además:

- **Router `settle`**: rechaza deudas de dos deudores distintos y acepta que registre el pago el
  acreedor.
- **Comprobación manual en local** (móvil y escritorio): ver Hogar, saldar un fijo, reabrir uno
  importado.
