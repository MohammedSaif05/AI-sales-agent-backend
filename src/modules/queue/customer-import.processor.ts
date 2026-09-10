import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CustomerImportsService } from '../customer-imports/customer-imports.service';

export interface CustomerImportJobData {
  importId: string;
  businessId: string;
}

@Injectable()
@Processor('customer-imports')
export class CustomerImportProcessor extends WorkerHost {
  private readonly logger = new Logger(CustomerImportProcessor.name);

  constructor(
    @Inject(forwardRef(() => CustomerImportsService))
    private readonly importsService: CustomerImportsService,
  ) {
    super();
  }

  async process(job: Job<CustomerImportJobData>): Promise<void> {
    const { importId, businessId } = job.data;
    this.logger.log(
      `Starting background processing for importId: ${importId} (Job ${job.id})`,
    );

    try {
      await this.importsService.processImportJob({ importId, businessId });
      this.logger.log(`Completed import processing for importId: ${importId}`);
    } catch (err: unknown) {
      this.logger.error(
        `Fatal error during import processing for importId: ${importId}`,
        err,
      );
      throw err;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<CustomerImportJobData>, err: Error) {
    this.logger.error(
      `Job ${job.id} for importId ${job.data?.importId} failed: ${err.message}`,
    );
  }
}
