import { Type } from 'class-transformer';
import { IsDateString, IsInt, Min } from 'class-validator';

export class ReportQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  metricId!: number;

  @IsDateString({ strict: true }, { message: 'dateInitial deve estar em YYYY-MM-DD' })
  dateInitial!: string;

  @IsDateString({ strict: true }, { message: 'finalDate deve estar em YYYY-MM-DD' })
  finalDate!: string;
}
