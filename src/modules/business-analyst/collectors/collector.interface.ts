export interface CollectorOptions {
  isDemographicRequested?: boolean;
}

export interface CollectorResult<T> {
  isAvailable: boolean;
  data: T | null;
  limitations: string[];
}

export interface IAnalyticsCollector<T> {
  collect(
    businessId: string,
    periodFrom: Date,
    periodTo: Date,
    timezone?: string,
    options?: CollectorOptions,
  ): Promise<CollectorResult<T>>;
}
