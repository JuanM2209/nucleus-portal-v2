export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    total: number;
    page: number;
    limit: number;
  };
}

export function successResponse<T>(data: T, meta?: ApiResponse<T>['meta']): ApiResponse<T> {
  return { success: true, data, meta };
}

export function errorResponse(message: string): ApiResponse<never> {
  return { success: false, error: message };
}

export function paginatedResponse<T>(
  data: T,
  total: number,
  page: number,
  limit: number,
): ApiResponse<T> {
  return { success: true, data, meta: { total, page, limit } };
}
