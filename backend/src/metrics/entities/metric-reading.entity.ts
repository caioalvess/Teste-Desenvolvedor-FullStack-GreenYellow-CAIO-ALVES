import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('metric_readings')
@Unique('uq_metric_readings_metric_datetime', ['metricId', 'dateTime'])
@Index('idx_metric_readings_metric_datetime', ['metricId', 'dateTime'])
export class MetricReading {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'metric_id', type: 'integer' })
  metricId!: number;

  @Column({ name: 'date_time', type: 'timestamp without time zone' })
  dateTime!: Date;

  @Column({ type: 'integer' })
  value!: number;
}
