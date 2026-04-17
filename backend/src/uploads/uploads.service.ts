import { Injectable, Logger } from '@nestjs/common';
import { RabbitMqService } from '../rabbitmq/rabbitmq.service';
import { UploadStatusStore } from './upload-status.store';

export type UploadedMessage = {
  blobName: string;
  originalName: string;
  uploadedAt: string;
  size: number;
};

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly rabbitmq: RabbitMqService,
    private readonly statusStore: UploadStatusStore,
  ) {}

  /**
   * O Multer + AzuriteStorageEngine ja' fez o streaming do arquivo pro blob.
   * Aqui so' montamos a mensagem de "trabalho" pra fila do consumer e
   * pre-registramos o status como "pending".
   */
  async handleUpload(file: Express.Multer.File): Promise<UploadedMessage> {
    const blobName = file.filename; // preenchido pelo engine
    this.logger.log(`Uploaded ${blobName} (${file.size} bytes) to Azurite`);

    this.statusStore.register(blobName);

    const message: UploadedMessage = {
      blobName,
      originalName: file.originalname,
      uploadedAt: new Date().toISOString(),
      size: file.size,
    };
    const queue = this.rabbitmq.uploadQueue;
    this.rabbitmq.publish(queue, message);
    this.logger.log(`Published ${blobName} to queue ${queue}`);

    return message;
  }
}
