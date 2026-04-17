import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AzuriteModule } from './azurite/azurite.module';
import { RabbitMqModule } from './rabbitmq/rabbitmq.module';
import { HealthModule } from './health/health.module';
import { UploadStatusModule } from './uploads/upload-status.module';
import { UploadsModule } from './uploads/uploads.module';
import { MetricsModule } from './metrics/metrics.module';
import { ConsumerModule } from './consumer/consumer.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AzuriteModule,
    RabbitMqModule,
    UploadStatusModule,
    HealthModule,
    UploadsModule,
    MetricsModule,
    ConsumerModule,
  ],
})
export class AppModule {}
