import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service';

// Shape que o AzuriteStorageEngine devolve no objeto `file`:
// - originalname: nome original do arquivo
// - filename: o blobName gerado (uuid-nome_seguro.csv)
// - size: preenchido pelo engine apos uploadStream
type UploadedCsvFile = Express.Multer.File;

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

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
}
