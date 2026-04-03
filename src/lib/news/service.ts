import { aggregateNews, type AggregateNewsOptions } from "./aggregator";
import type { NewsAggregationResponse, NewsQueryParams } from "./types";

export async function runNewsAggregation(
  params: NewsQueryParams,
  options?: AggregateNewsOptions
): Promise<NewsAggregationResponse> {
  return aggregateNews(params, options);
}
