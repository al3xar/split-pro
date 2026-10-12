# Hogar: deudas por gasto, pantalla de inicio, importador de Tricount y modo claro

- **Fecha:** 2026-10-12
- **Estado:** aprobado en conversación, pendiente de revisión escrita
- **Sustituye a:** `2026-10-12-pagos-por-gasto-design.md` (el modelo con tabla `Settlement` y
  `settlementId` en `ExpenseParticipant` queda descartado)
- **Diseño visual:** `docs/DESIGN.md`

## 0. Objetivo y orden

Una pareja comparte los gastos de casa en un grupo marcado como **Hogar**. La pantalla de inicio
muestra en qué se gasta, quién paga y qué queda por pagar de cada cosa (alquiler, comida, la cena
de anoche). Los datos actuales vienen de Tricount.

Orden de implementación (cada parte se prueba en local y se despliega al terminarla):

1. Deudas por gasto con compensación automática (§1)
2. Pantalla Hogar (§2)
3. Importador de Tricount (§3)
4. Modo claro (§4)

## 1. Deudas por gasto con compensación automática

### 1.1 Principio

El estado de cada deuda **no se guarda: se deriva**. La vista `BalanceView`, los saldos netos y la
simplificación de deudas no cambian. Encima de ellos se calcula, para cada par de personas en un
grupo y moneda, qué parte de cada deuda está cubierta.

### 1.2 Definiciones (par A–B, un grupo, una moneda)

- **Deuda:** la parte de un gasto que una persona debe a quien lo pagó
  (`-ExpenseParticipant.amount` de la fila del deudor cuando `paidBy` es la otra persona).
- **Crédito del deudor:** todo lo que reduce su deuda con la otra persona:
  - deudas de la otra persona hacia él (gastos que pagó el deudor);
  - pagos del deudor a la otra persona (gastos `SETTLEMENT`, incluidos los reembolsos importados).
- **Deudor neto:** quien debe más de lo que tiene a favor. Con neto 0 no hay deudor.
- Las deudas del **acreedor** neto se muestran como **compensadas** (las cubren los créditos del
  deudor, de sobra).

### 1.3 Reparto de créditos sobre las deudas del deudor neto

1. **Pagos dirigidos:** un pago hecho desde "Saldar" lleva la lista de deudas elegidas
   (tabla `SettlementTarget`, ver 1.5). Su importe cubre esas deudas primero, en su orden.
2. **Resto de créditos** (gastos pagados por el deudor, pagos no dirigidos, sobrante de dirigidos):
   se reparten sobre las deudas que sigan pendientes **por prioridad de categoría** y, dentro de
   la misma prioridad, **de la más antigua a la más reciente** (`expenseDate`, luego `createdAt`).
3. Los importes **pueden ser parciales**: "Alquiler octubre: quedan 380 € de 450 €".
4. La suma de lo pendiente es siempre igual al saldo neto (invariante comprobado en tests).

### 1.4 Prioridades (configurables más adelante; fijas en esta versión)

| Prioridad | Nombre | Categorías |
|---|---|---|
| 1 | Vivienda y fijos | `rent`, `mortgage`, la sección `utilities` y todos sus elementos, `insurance`, y **cualquier gasto recurrente** (`recurrenceId` no nulo) |
| 2 | Comida | `groceries`, `food` (otros de comida) |
| 3 | Otros | todo lo que no esté en 1, 2 ni 4 |
| 4 | Ocio | `diningOut`, `liquor`, `entertainment` y sus elementos |

Nota: `home` como sección genérica (sin elemento) cae en "Otros"; solo `rent`/`mortgage` son fijos
dentro de Hogar.

### 1.5 Saldar

- Solo el **deudor neto** ve el botón. Cualquiera de los dos puede registrar un pago desde la
  pantalla del Hogar o del amigo, pero el sentido siempre es deudor → acreedor.
- Selector con las deudas **pendientes** (importe restante), agrupadas por prioridad, todas
  marcadas; chips de filtro rápido por prioridad ("Fijos", "Comida", "Ocio"…).
- Total = suma de lo restante de las elegidas. **Sin importe libre.**
- Se crea un gasto `SETTLEMENT` como hoy y filas `SettlementTarget(settlementId, expenseId, order)`.
- **Deshacer** = borrar el gasto de pago (flujo existente).
- Editar o borrar cualquier gasto recalcula todo; no hay estados que corromper.

### 1.6 Datos nuevos

```prisma
model SettlementTarget {
  settlementId String  @db.Uuid   // Expense SETTLEMENT
  expenseId    String  @db.Uuid   // deuda elegida
  order        Int
  settlement   Expense @relation("SettlementTargets", fields: [settlementId], references: [id], onDelete: Cascade)
  expense      Expense @relation("SettledBy", fields: [expenseId], references: [id], onDelete: Cascade)
  @@id([settlementId, expenseId])
  @@schema("public")
}
```

### 1.7 Lógica pura (`src/lib/debts.ts`)

`allocateDebts({ userA, userB, rows, payments, targets })` → por deuda: `{ expenseId, debtorId,
category, priority, amount, covered, remaining, status: 'pending' | 'partial' | 'settled' |
'compensated' }`, más `net`, `debtorId`, totales por prioridad y por categoría.

### 1.8 API

- `debts.getPair({ groupId?, friendId?, currency })` → resultado de `allocateDebts` + datos de
  los gastos (nombre, fecha, categoría).
- `debts.settle({ groupId?, friendId?, currency, expenseIds[], expectedTotal })` → transacción
  que recalcula, valida (deudor neto, deudas pendientes, total igual a `expectedTotal`) y crea el
  `SETTLEMENT` con sus `SettlementTarget`. `CONFLICT` si los datos cambiaron.

## 2. Pantalla Hogar

### 2.1 Grupo Hogar

- `Group.isHousehold Boolean @default(false)`; interruptor "Usar como Hogar" en los ajustes del
  grupo (cualquier miembro). Si hay varios, se usa el marcado más recientemente
  (`householdSince DateTime?`).
- Ruta `/household`, primera entrada del menú ("Hogar"); en el despliegue,
  `DEFAULT_HOMEPAGE=/household`. Sin grupo Hogar: estado vacío con dos acciones
  ("Marcar un grupo como Hogar", "Importar de Tricount").

### 2.2 Contenido (de arriba abajo)

1. **Cabecera:** nombre del grupo, miembros, selector de periodo (Este mes · 3 meses · Año · Todo)
   que afecta a 3 y 4; las deudas (2) siempre son el estado actual.
2. **Saldo y pendiente por categoría** (estado actual, moneda del grupo):
   - Frase principal: "Tu pareja te debe 380 €" / "Debes 380 €" / "Estáis en paz".
   - Lista por prioridad → categoría → gastos: nombre, fecha, "quedan X de Y". Lo saldado se
     agrupa plegado ("✓ 12 saldados").
   - Botón **Saldar** (deudor neto).
3. **Gasto del hogar por categoría** (periodo): barras horizontales por sección, total del periodo
   y variación frente al periodo anterior.
4. **Quién ha pagado** (periodo): barra dividida con % y € por persona; debajo, **un quesito
   (donut) por persona** con sus categorías (máx. 5 + "Otros"), leyenda y tabla equivalente.
5. **Últimos gastos** del grupo (5) con enlace al grupo.

### 2.3 Gráficas

Mismo sistema que Análisis: paleta validada, tokens `--chart-*`, una sola escala, etiquetas al
pasar/enfocar, vista en tabla. Colores por persona: slot 1 y slot 2 de la paleta categórica.
Categorías del donut: slots 1–5 + gris neutro para "Otros", validados con el script de dataviz.

## 3. Importador de Tricount

### 3.1 Flujo (`/import-tricount`, enlace en Cuenta)

1. Pegar enlace (`https://tricount.com/<clave>` o la clave sola).
2. Vista previa: título, moneda, participantes, nº de gastos/reembolsos/ingresos, rango de fechas,
   total.
3. Emparejar cada participante con: **yo**, un amigo existente, o un usuario nuevo por email.
4. Destino: grupo nuevo (nombre = título de Tricount) con "Usar como Hogar" marcado por defecto.
5. Importar y mostrar resumen (creados, ya existentes omitidos).

### 3.2 Cliente de la API (no oficial)

- Base `https://api.tricount.bunq.com`; única salida de red permitida.
- `POST /v1/session-registry-installation` con `app_installation_uuid`, `client_public_key`
  (RSA 2048 PEM PKCS#1 generada en el servidor con `node:crypto`) y `device_description`.
- `GET /v1/user/<id>/registry?public_identifier_token=<clave>` con
  `X-Bunq-Client-Authentication`.
- Errores de red o de formato → mensaje claro ("Tricount ha cambiado su API o el enlace no es
  válido"); nunca se importa a medias (todo en una transacción).

### 3.3 Mapeo

| Tricount | SplitPro |
|---|---|
| `type_transaction = NORMAL` | gasto `EXACT`, `paidBy` = `membership_owned`, participantes según `allocations` |
| `BALANCE` (reembolso) | gasto `SETTLEMENT` entre pagador y receptor |
| `INCOME` | gasto con importe negativo (dinero recibido y repartido) |
| `amount_local` (moneda del tricount) | `amount` y `currency` del gasto; si la moneda original difiere, se anota en la descripción |
| `category` / `category_custom` | categoría de SplitPro por tabla de mapeo; desconocida → `general` |
| `date` | `expenseDate` |
| `uuid` | `transactionId = "tricount:<uuid>"` (evita duplicados en reimportaciones) |

El mapeo exacto de categorías se ajusta con la respuesta real del tricount del usuario (se guarda
anonimizada como fixture de tests).

## 4. Modo claro

- Selector **Sistema / Claro / Oscuro** en Cuenta (`next-themes`), por defecto Sistema.
- Sustituir los grises fijos (`text-gray-*`, `bg-gray-*`, `border-gray-*`, ~120) por tokens del
  tema (`text-muted-foreground`, `bg-muted`, `border-border`…) siguiendo `docs/DESIGN.md`.
- Tokens claros revisados para contraste AA; gráficas ya tienen tokens claros validados.

## 5. Pruebas

- **Unitarias:** `allocateDebts` (prioridades, antigüedad, parciales, pagos dirigidos, sobrante,
  compensadas, neto 0, invariante suma = neto); mapeo de Tricount con fixtures (NORMAL, BALANCE,
  INCOME, multimoneda, categoría desconocida, reimportación sin duplicados).
- **Manual en local:** pareja con alquiler + comidas + cenas: las cenas del deudor cubren el
  alquiler automáticamente; Saldar dirigido; deshacer; importación de un tricount real; modo claro
  en todas las pantallas principales.
- **Despliegue:** copia de seguridad de la base de datos antes de cada migración.
