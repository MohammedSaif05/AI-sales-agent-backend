import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly publicUrl?: string;

  constructor(private readonly configService: ConfigService) {
    const accountId = this.configService.get<string>('R2_ACCOUNT_ID') || '';
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID') || '';
    const secretAccessKey =
      this.configService.get<string>('R2_SECRET_ACCESS_KEY') || '';
    this.bucketName =
      this.configService.get<string>('R2_BUCKET_NAME') || 'sales-agent-bucket';
    this.publicUrl = this.configService.get<string>('R2_PUBLIC_URL');

    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: accountId
        ? `https://${accountId}.r2.cloudflarestorage.com`
        : 'https://placeholder.r2.cloudflarestorage.com',
      credentials: {
        accessKeyId: accessKeyId || 'placeholder',
        secretAccessKey: secretAccessKey || 'placeholder',
      },
      forcePathStyle: true,
    });
  }

  /**
   * Uploads a buffer to Cloudflare R2
   */
  async uploadBuffer(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      });

      await this.s3Client.send(command);
      this.logger.log(`Uploaded file to R2: key=${key} (${buffer.length} bytes)`);
      return key;
    } catch (err: unknown) {
      this.logger.error(`Failed to upload file to R2: key=${key}`, err);
      // In development / testing without real credentials, return key so dev continues
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(`Dev mode fallback: returning storageKey without live R2 upload`);
        return key;
      }
      throw new Error('Failed to upload file to object storage');
    }
  }

  /**
   * Generates a secure pre-signed download URL (expires in 1 hour by default)
   */
  async getSignedDownloadUrl(
    key: string,
    expiresInSeconds: number = 3600,
  ): Promise<string> {
    if (this.publicUrl) {
      return `${this.publicUrl.replace(/\/$/, '')}/${key}`;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      return await getSignedUrl(this.s3Client, command, {
        expiresIn: expiresInSeconds,
      });
    } catch (err: unknown) {
      this.logger.warn(`Could not generate presigned URL for key=${key}: ${err}`);
      return `https://storage.local/${key}`;
    }
  }

  /**
   * Downloads a buffer from Cloudflare R2
   */
  async downloadBuffer(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      const byteArray = await response.Body?.transformToByteArray();
      if (!byteArray) {
        throw new Error(`File stream was empty for key: ${key}`);
      }
      return Buffer.from(byteArray);
    } catch (err: unknown) {
      this.logger.error(`Failed to download buffer from R2: key=${key}`, err);
      throw new Error('Failed to retrieve file from object storage');
    }
  }

  /**
   * Deletes an object from Cloudflare R2
   */
  async deleteObject(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      await this.s3Client.send(command);
    } catch (err: unknown) {
      this.logger.error(`Failed to delete object from R2: key=${key}`, err);
    }
  }
}
