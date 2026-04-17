import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlobServiceClient } from '@azure/storage-blob';
import type { CheckResult } from '../health.controller';

@Injectable()
export class AzuriteHealthCheck {
  private readonly logger = new Logger(AzuriteHealthCheck.name);

  constructor(private readonly config: ConfigService) {}

  async check(): Promise<CheckResult> {
    const connectionString = this.config.get<string>('AZURITE_CONNECTION_STRING');
    if (!connectionString) {
      return { status: 'down', detail: 'AZURITE_CONNECTION_STRING not set' };
    }
    try {
      const client = BlobServiceClient.fromConnectionString(connectionString);
      await client.getProperties();
      return { status: 'ok' };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`Azurite check failed: ${message}`);
      return { status: 'down', detail: message };
    }
  }
}
