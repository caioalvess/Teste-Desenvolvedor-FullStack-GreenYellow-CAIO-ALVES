import { Global, Module } from '@nestjs/common';
import { UploadStatusStore } from './upload-status.store';

@Global()
@Module({
  providers: [UploadStatusStore],
  exports: [UploadStatusStore],
})
export class UploadStatusModule {}
