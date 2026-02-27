const MAX_UPLOAD_BYTES = 700 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42];

function dataUrlSizeBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || '';
  const padding = (base64.match(/=*$/)?.[0].length || 0);
  return (base64.length * 3) / 4 - padding;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };
    image.src = objectUrl;
  });
}

export async function compressImageForUpload(file: File): Promise<string> {
  const originalDataUrl = await readFileAsDataUrl(file);
  if (dataUrlSizeBytes(originalDataUrl) <= MAX_UPLOAD_BYTES) {
    return originalDataUrl;
  }

  const image = await loadImageFromFile(file);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    return originalDataUrl;
  }
  context.drawImage(image, 0, 0, width, height);

  for (const quality of JPEG_QUALITIES) {
    const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrlSizeBytes(compressedDataUrl) <= MAX_UPLOAD_BYTES) {
      return compressedDataUrl;
    }
  }

  throw new Error('Image is too large. Please choose a smaller photo.');
}
