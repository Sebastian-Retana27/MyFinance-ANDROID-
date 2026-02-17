# MyFinance (Expo + SQLite Offline)

Base inicial para app movil 100% offline con React Native (Expo) y SQLite local.

## Requisitos

- Node.js 20+
- Expo Go instalado en tu telefono
- PC y telefono en la misma red

## Ejecutar en tiempo real (Expo Go)

```bash
npx expo start --offline
```

Si `8081` esta ocupado, acepta el cambio al puerto sugerido (por ejemplo `8082`).

## Funciones implementadas

- SQLite local funcionando (`expo-sqlite`)
- Alta y listado de gastos local
- Carga de captura de factura desde galeria (`expo-image-picker`)
- Analizador de texto de factura que calcula por producto:
  - Nombre
  - Unidades compradas
  - Precio unitario
  - Total por linea
- Resumen total de la factura:
  - Total de dinero
  - Total de unidades

## Nota tecnica sobre OCR local + Expo Go

Expo Go no incluye modulos OCR nativos de terceros. En esta version:

- Se puede cargar la captura de factura.
- Se puede pegar/corregir el texto OCR y analizarlo 100% offline.

Para OCR local automatico real en el dispositivo, el siguiente paso es usar Expo Dev Client + modulo OCR nativo.