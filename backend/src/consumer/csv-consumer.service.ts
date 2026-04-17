import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AzuriteService } from '../azurite/azurite.service';
import { RabbitMqService } from '../rabbitmq/rabbitmq.service';
import { MetricsRepository } from '../metrics/metrics.repository';
import { parseRowsInBatches } from '../metrics/csv-parser.util';
import { UploadStatusStore } from '../uploads/upload-status.store';

type UploadedMessage = {
  blobName: string;
  originalName: string;
  uploadedAt: string;
  size: number;
};

const BATCH_SIZE = 1000;

@Injectable()
export class CsvConsumerService implements OnModuleInit {
  private readonly logger = new Logger(CsvConsumerService.name);

  constructor(
    private readonly rabbitmq: RabbitMqService,
    private readonly azurite: AzuriteService,
    private readonly metrics: MetricsRepository,
    private readonly statusStore: UploadStatusStore,
  ) {}

  async onModuleInit() {
    await this.rabbitmq.consume(this.rabbitmq.uploadQueue, async (payload) => {
      await this.process(payload as UploadedMessage);
    });
  }

  private async process(msg: UploadedMessage): Promise<void> {
    const startedAt = Date.now();
    this.logger.log(`Processing ${msg.blobName} (${msg.size} bytes) [streaming]`);
    this.statusStore.start(msg.blobName);

    try {
      const stream = await this.azurite.downloadBlobStream(msg.blobName);

      let totalRead = 0;
      let totalInserted = 0;
      let batchNumber = 0;

      for await (const batch of parseRowsInBatches(stream, BATCH_SIZE)) {
        batchNumber += 1;
        totalRead += batch.length;
        const inserted = await this.metrics.insertBatch(batch);
        totalInserted += inserted;
        this.statusStore.incrementRows(msg.blobName, batch.length);
      }

      this.statusStore.complete(msg.blobName);
      const elapsed = Date.now() - startedAt;
      this.logger.log(
        `Persisted ${totalInserted}/${totalRead} rows in ${batchNumber} batches (${elapsed}ms) from ${msg.blobName}`,
      );
    } catch (err) {
      const message = (err as Error).message;
      this.statusStore.fail(msg.blobName, message);
      throw err; // re-lanca pro wrapper do RabbitMqService fazer nack
    }
  }
}
