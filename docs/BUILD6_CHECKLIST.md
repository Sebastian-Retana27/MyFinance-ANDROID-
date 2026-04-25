# Build 6 Upgrade Checklist (sin pérdida de datos)

## Pre-release

1. Confirmar `android.package = com.caentertainment.myfinance`.
2. Confirmar misma keystore/firma.
3. Subir `versionCode` y `versionName`.
4. Verificar que `initDb()` no use `DROP TABLE`.
5. Ejecutar TypeScript:

```bash
npx tsc --noEmit
```

## Prueba de actualización real

1. Instalar APK anterior con datos reales.
2. Crear una cuenta y varios gastos.
3. Instalar APK nueva encima (update).
4. Abrir app y validar persistencia:
   - cuentas
   - productos
   - presupuestos
   - categorías y colores
   - idioma, tema, formato numérico
5. Ejecutar flujos críticos:
   - gasto manual
   - subir recibo OCR
   - transferencia recibida
   - transferencia enviada
   - eliminar producto (soft delete)
6. Confirmar que cuentas no se rompen y saldos tienen trazabilidad en `account_movements`.

## Smoke snapshot (opcional recomendado)

Consumir `getUpgradeSmokeSnapshot()` desde un screen/hook temporal y revisar:

- `schemaVersion` esperado
- conteos coherentes en `transactions` y `account_movements`

## Build command

```bash
npx eas build --platform android --profile preview
```
