import {
  Controller,
  Get,
  Header,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { AggregateQueryDto } from './dto/aggregate-query.dto';
import { ReportQueryDto } from './dto/report-query.dto';
import { buildReportWorkbook } from './excel-report.util';
import { AggregatedPoint, MetricsRepository } from './metrics.repository';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly repo: MetricsRepository) {}

  @Get('aggregate')
  async aggregate(@Query() query: AggregateQueryDto): Promise<AggregatedPoint[]> {
    return this.repo.aggregate({
      metricId: query.metricId,
      dateInitial: query.dateInitial,
      finalDate: query.finalDate,
      granularity: query.granularity,
    });
  }

  @Get('report')
  @Header('Content-Type', XLSX_MIME)
  async report(
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const rows = await this.repo.report(query);
    const buffer = await buildReportWorkbook(rows);
    const filename = `report-${query.metricId}-${query.dateInitial}_to_${query.finalDate}.xlsx`;
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(buffer);
  }
}
