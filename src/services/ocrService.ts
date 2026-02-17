import TextRecognition from '@react-native-ml-kit/text-recognition';

export type OcrResult = {
  text: string;
  confidence: number;
};

export async function readTextFromImageLocal(imageUri: string): Promise<OcrResult> {
  if (!imageUri) {
    throw new Error('No se recibió una imagen para procesar.');
  }

  try {
    const result = await TextRecognition.recognize(imageUri);
    const text = result.text?.trim() ?? '';

    if (!text) {
      throw new Error('No se detectó texto en la imagen.');
    }

    // ML Kit no devuelve confidence global en este wrapper.
    return { text, confidence: 1 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isExpoGoLinkingError =
      message.includes("doesn't seem to be linked") || message.includes('Expo managed workflow');

    if (isExpoGoLinkingError) {
      throw new Error(
        'OCR automático requiere build nativo Android (Dev Client o APK/AAB). En Expo Go no está disponible.'
      );
    }

    throw new Error(`Falló OCR local: ${message}`);
  }
}
