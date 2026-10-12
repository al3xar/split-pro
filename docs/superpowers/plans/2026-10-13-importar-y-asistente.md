# Importar y asistente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diálogo global de añadir gasto, importación de extractos con bandeja y gastos personales, y asistente con LLM compatible con OpenAI.

**Architecture:** El formulario existente se reutiliza en un diálogo global controlado por un store; la importación es lógica pura (`statement.ts`, `categoryGuess.ts`) + modelos nuevos + router `inbox`; el asistente es un bucle servidor con cliente HTTP inyectable y herramientas que solo leen o proponen.

**Tech Stack:** Next.js 15 pages, tRPC, Prisma, Zustand, Jest.

**Spec:** `docs/superpowers/specs/2026-10-13-importar-y-asistente-design.md`

## Global Constraints

- Convenciones de `AGENTS.md` (Yoda, flechas, iteradores, imports ordenados); textos en `en` y `es`.
- Importes `bigint`; tokens de tema de `docs/DESIGN.md`; objetivos ≥ 44px.
- Ninguna escritura desde el asistente sin el diálogo de A; claves del LLM solo en servidor.
- Antes de desplegar: `pg_dump` a `/volume1/docker/splitpro/backups/`; imagen desde `git archive HEAD`.

## Review Focus

- CSV con BOM, líneas vacías finales o separador decimal coma → parsea igual (Task 3, tests `strips BOM`, `ignores blank lines`, `parses comma decimals`).
- Mismo extracto importado dos veces, o dos movimientos idénticos el mismo día → no duplica y no pierde el segundo (Task 3, `repeated rows get distinct hashes`).
- Movimiento clasificado como compartido pero diálogo cancelado → sigue pendiente (Task 6, manual).
- El LLM pide una herramienta inexistente o con argumentos inválidos → error controlado devuelto al modelo, sin romper (Task 8, `invalid tool call is reported back`).
- El LLM no deja de llamar herramientas → corta en `LLM_MAX_STEPS` (Task 8, `stops after max steps`).

---

### Task 1: Store y diálogo global de añadir gasto
**Files:** Create `src/store/addExpenseDialogStore.ts`, `src/hooks/useInitAddExpense.ts`, `src/components/AddExpense/AddExpenseDialog.tsx`; Modify `src/pages/add.tsx` (usar el hook), `src/components/AddExpense/AddExpensePage.tsx` (`onSaved`, `onCancel`), `src/server/api/routers/expense.ts` (`getAddConfig`), `src/pages/_app.tsx` (montar diálogo).
**Interfaces:** Produces `useAddExpenseDialog(): { open; prefill: AddExpensePrefill | null; openWith(p?: AddExpensePrefill): void; close(): void }`; `AddExpensePrefill` como en la spec §A.
- [ ] Extraer la lógica de `add.tsx` a `useInitAddExpense`, sin cambiar el comportamiento de `/add` (verificar `/add`, `/add?groupId=`, edición).
- [ ] Diálogo + prefill + `onSaved`/`onCancel`; `pnpm tsgo --noEmit`, lint.
- [ ] Commit `feat(add): global add-expense dialog`.

### Task 2: Abrir el diálogo desde toda la app
**Files:** Modify `MainLayout.tsx` (Añadir = botón), `household.tsx`, `balances.tsx`, `balances/[friendId].tsx`, `groups.tsx`, `groups/[groupId].tsx`, `analytics.tsx` (botón "+" con contexto).
- [ ] Implementar; prueba manual (crear desde Hogar, desde un amigo, desde el menú; cancelar; la lista se refresca).
- [ ] Commit `feat(add): open the add dialog from every screen`; desplegar parte A.

### Task 3: Parser de extractos (puro)
**Files:** Create `src/lib/statement.ts`, `src/tests/statement.test.ts`.
**Interfaces:** `parseCsv(text): { headers: string[]; rows: string[][] }`; `detectMapping(headers, rows): StatementMapping`; `parseAmount(value, decimal: ','|'.'): bigint` (unidades mínimas, con signo); `parseStatementDate(value, format): Date`; `toTransactions(parsed, mapping): ParsedTransaction[]` (`{ date, description, amount, hash }`).
- [ ] Tests: separadores `;` `,` tab, comillas con separador dentro, `strips BOM`, `ignores blank lines`, `parses comma decimals` (`1.234,56`→123456n, `-12,50`→-1250n), punto decimal, columnas cargo/abono, 5 formatos de fecha (incl. ISO con Z), detección de columnas ES/EN, `repeated rows get distinct hashes`. Ver fallar, implementar, ver pasar.
- [ ] Commit `feat(import): statement CSV parser`.

### Task 4: Categorías y reglas (puro)
**Files:** Create `src/lib/categoryGuess.ts`, `src/tests/categoryGuess.test.ts`; Modify `src/lib/tricount.ts` (usar `guessCategory`).
**Interfaces:** `guessCategory(text): string | null`; `normalizeMerchant(text): string`; `matchRule(rules: {pattern; action; category}[], text): rule | null` (patrón más largo gana).
- [ ] Tests (incluidos los de Tricount existentes en verde); implementar; commit `feat(import): category guessing and rules`.

### Task 5: Modelos, gastos personales y router `inbox`
**Files:** `prisma/schema.prisma` + migración `add_bank_import`; Modify `src/lib/analytics.ts` (+ tests: gastos personales suman a gastos y categorías), `src/server/api/routers/analytics.ts`, `src/lib/finance.ts` (`EXPENSE`), Create `src/server/api/routers/inbox.ts`.
**Interfaces:** `inbox.importRows({ source, currency, rows: {date, description, amount, hash}[] })`→`{created, duplicates}`; `inbox.list({status})`; `inbox.classify({ ids, action, category?, remember?: boolean })` (PERSONAL/INCOME/IGNORED crean FinanceEntry o nada); `inbox.linkExpense({ id, expenseId })`; `inbox.profiles` / `saveProfile`; `inbox.pendingCount`.
- [ ] Test RED de analytics con `EXPENSE` → implementar → GREEN; migración; router; commit `feat(import): imported transactions, rules and personal expenses`.

### Task 6: Pantallas de importación y bandeja
**Files:** Create `src/pages/bank-import.tsx`, `src/pages/inbox.tsx`; Modify `account.tsx`, `household.tsx` (aviso con contador), `finances.tsx` (sección gastos personales), locales.
- [ ] Implementar; prueba manual con un CSV de ejemplo ES (`;`, coma decimal) y uno estilo TR (`,`, ISO); commit `feat(import): import page and inbox`; desplegar parte B.

### Task 7: Cliente LLM y bucle del asistente (puro + inyectable)
**Files:** Create `src/server/assistant/llm.ts`, `src/server/assistant/agent.ts`, `src/tests/assistant.test.ts`; Modify `src/env.ts` (`LLM_*`).
**Interfaces:** `chatCompletion(config, messages, tools, fetchImpl?)`; `runAgent({ messages, tools: ToolDef[], execute(name, args), complete, maxSteps })` → `{ messages: ChatMsg[], proposals: AddExpensePrefill[] }`.
- [ ] Tests: respuesta sin herramientas; una ronda de herramienta; `invalid tool call is reported back`; `stops after max steps`; `propose_expense returns a proposal without writing`. Implementar; commit `feat(assistant): LLM client and agent loop`.

### Task 8: Herramientas, conversaciones y router `assistant`
**Files:** `prisma/schema.prisma` + migración `add_chat`; Create `src/server/assistant/tools.ts`, `src/server/api/routers/assistant.ts`.
**Interfaces:** `assistant.enabled`, `assistant.conversations`, `assistant.messages({conversationId})`, `assistant.send({conversationId?, text, timeZone})`, `assistant.proposalResult({conversationId, toolCallId, saved, expenseId?})`, `assistant.delete({conversationId})`.
- [ ] Implementar herramientas sobre servicios existentes (`householdStats`, `loadPairDebts`, consultas de gastos/bandeja); commit `feat(assistant): tools, conversations and API`.

### Task 9: Interfaz del asistente
**Files:** Create `src/pages/assistant.tsx`, `src/components/Assistant/*`; Modify `household.tsx`, `analytics.tsx`, `account.tsx`, locales.
- [ ] Implementar; prueba manual contra el endpoint real si hay clave en `.env` local (si no, con un servidor simulado); commit `feat(assistant): chat UI`; desplegar parte C (variables `LLM_*` vacías hasta resolver la red).
