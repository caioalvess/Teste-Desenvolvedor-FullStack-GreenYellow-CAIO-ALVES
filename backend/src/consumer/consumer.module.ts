import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { CsvConsumerService } from './csv-consumer.service';

@Module({
  imports: [MetricsModule],
  providers: [CsvConsumerService],
})
export class ConsumerModule {}
