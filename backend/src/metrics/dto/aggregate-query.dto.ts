import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export enum Granularity {
  DAY = 'DAY',
  MONTH = 'MONTH',
  YEAR = 'YEAR',
}

export class AggregateQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  metricId!: number;

  @IsDateString({ strict: true }, { message: 'dateInitial deve estar em YYYY-MM-DD' })
  dateInitial!: string;

  @IsDateString({ strict: true }, { message: 'finalDate deve estar em YYYY-MM-DD' })
  finalDate!: string;

  @IsOptional()
  @IsEnum(Granularity, { message: 'granularity deve ser DAY, MONTH ou YEAR' })
  granularity: Granularity = Granularity.DAY;
}
