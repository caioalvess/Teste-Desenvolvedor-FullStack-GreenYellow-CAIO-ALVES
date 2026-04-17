import { randomUUID } from 'node:crypto';
import type { StorageEngine } from 'multer';
import type { AzuriteService } from '../azurite/azurite.service';

/**
 * Multer storage engine customizado: em vez de bufferar o upload em memoria
 * (memoryStorage) ou escrever em /tmp (diskStorage), pipa o stream do campo
 * multipart direto pro Azurite via uploadStream.
 *
 * Com isso o pico de memoria da API num upload e' O(chunk_size * concurrency)
 * do SDK do Azure (~20MB), independente do tamanho do arquivo enviado.
 */
export class AzuriteStorageEngine implements StorageEngine {
  constructor(private readonly azurite: AzuriteService) {}

  _handleFile(
    _req: unknown,
    file: Express.Multer.File,
    cb: (error: Error | null, info?: Partial<Express.Multer.File>) => void,
  ): void {
    const safeName = file.originalname.replace(/[^\w.\-]+/g, '_');
    const blobName = `${randomUUID()}-${safeName}`;

    this.azurite
      .uploadFromStream(blobName, file.stream, file.mimetype)
      .then(({ size }) => {
        cb(null, {
          size,
          filename: blobName,
        });
      })
      .catch((err: unknown) => {
        cb(err instanceof Error ? err : new Error(String(err)));
      });
  }

  _removeFile(
    _req: unknown,
    _file: Express.Multer.File,
    cb: (error: Error | null) => void,
  ): void {
    // blob ja' esta' no Azurite. Em producao, este hook poderia deletar
    // o blob se o handler do Nest falhar pos-upload. Por ora, deixamos
    // sob responsabilidade de um cleanup job (anotado em melhorias).
    cb(null);
  }
}
