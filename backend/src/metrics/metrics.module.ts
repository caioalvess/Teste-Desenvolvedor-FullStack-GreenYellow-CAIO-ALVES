import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetricReading } from './entities/metric-reading.entity';
import { MetricsController } from './metrics.controller';
import { MetricsRepository } from './metrics.repository';

@Module({
  imports: [TypeOrmModule.forFeature([MetricReading])],
  controllers: [MetricsController],
  providers: [MetricsRepository],
  exports: [MetricsRepository],
})
export class MetricsModule {}
