import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config.js';

let isConfigured = false;

function ensureCloudinaryConfigured(): void {
  if (isConfigured) return;

  if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret) {
    throw new Error(
      'Cloudinary credentials (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) are not configured.'
    );
  }

  cloudinary.config({
    cloud_name: config.cloudinaryCloudName,
    api_key: config.cloudinaryApiKey,
    api_secret: config.cloudinaryApiSecret,
    secure: true,
  });

  isConfigured = true;
}

/**
 * Uploads a rendered vertical MP4 clip to Cloudinary and returns its secure HTTPS URL.
 */
export async function uploadClipToCloudinary(
  localFilePath: string,
  jobId: string,
  clipIndex: number
): Promise<string> {
  ensureCloudinaryConfigured();

  const uploadResult = (await new Promise((resolve, reject) => {
    cloudinary.uploader.upload_large(
      localFilePath,
      {
        resource_type: 'video',
        folder: `clipgenie/${jobId}`,
        public_id: `clip-${clipIndex + 1}`,
        overwrite: true,
        chunk_size: 20_000_000,
      },
      (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(result);
      }
    );
  })) as { secure_url?: string } | undefined;

  if (!uploadResult?.secure_url) {
    throw new Error('Cloudinary upload succeeded without returning a secure URL.');
  }

  return uploadResult.secure_url;
}
