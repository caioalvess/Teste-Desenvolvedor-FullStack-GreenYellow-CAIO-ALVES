import { BadRequestException, Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AzuriteService } from '../azurite/azurite.service';
import { AzuriteStorageEngine } from './azurite-storage.engine';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [AzuriteService],
      useFactory: (azurite: AzuriteService) => ({
        storage: new AzuriteStorageEngine(azurite),
        limits: { fileSize: MAX_UPLOAD_BYTES },
        fileFilter: (_req, file, cb) => {
          if (!file.originalname.toLowerCase().endsWith('.csv')) {
            cb(new BadRequestException('apenas arquivos .csv sao aceitos'), false);
            return;
          }
          cb(null, true);
        },
      }),
    }),
  ],
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
