import { Global, Module } from '@nestjs/common';
import { AzuriteService } from './azurite.service';

@Global()
@Module({
  providers: [AzuriteService],
  exports: [AzuriteService],
})
export class AzuriteModule {}
