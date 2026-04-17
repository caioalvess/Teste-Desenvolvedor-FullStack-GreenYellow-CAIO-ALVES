import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service';
import { UploadStatus, UploadStatusStore } from './upload-status.store';

type UploadedCsvFile = Express.Multer.File;

@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly statusStore: UploadStatusStore,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file?: UploadedCsvFile) {
    if (!file) {
      throw new BadRequestException(
        'campo "file" obrigatorio no multipart/form-data',
      );
    }
    return this.uploads.handleUpload(file);
  }

  @Get(':blobName/status')
  getStatus(@Param('blobName') blobName: string): UploadStatus {
    const status = this.statusStore.get(blobName);
    if (!status) {
      throw new NotFoundException(
        `status desconhecido para blob '${blobName}'`,
      );
    }
    return status;
  }
}
