export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pageCount: number;
}
