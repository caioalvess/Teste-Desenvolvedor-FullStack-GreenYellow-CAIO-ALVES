import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PostgresHealthCheck } from './checks/postgres.check';
import { RabbitMqHealthCheck } from './checks/rabbitmq.check';
import { AzuriteHealthCheck } from './checks/azurite.check';

@Module({
  controllers: [HealthController],
  providers: [PostgresHealthCheck, RabbitMqHealthCheck, AzuriteHealthCheck],
})
export class HealthModule {}
